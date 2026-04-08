import type { LanguageModel } from "ai";
import { pickDefault, type DetectedProvider } from "../ai/detect.js";
import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { Session } from "../core/session.js";
import { getTools, type ToolName } from "../tools/registry.js";
import { getSettings, type Mode } from "../core/config.js";
import { resolveTurnPolicy } from "../core/turn-policy.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import type { ModelHandle } from "../ai/providers.js";
import { tryCsvToParquetFastPath, tryLostGitRecoveryFastPath } from "./oneshot-fastpath.js";
import { tryRepoTaskFastPath } from "./repo-fastpath.js";
import { applyTurnFrame } from "./turn-frame.js";
import { buildMinimalOutputInstruction, getMinimalOutputPolicy } from "./turn-runner-support.js";

function canUseSdkTools(model: ModelHandle): boolean {
  return model.runtime === "sdk"
    && !!model.model
    && ["anthropic", "openai", "codex", "google", "mistral", "groq", "xai", "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm"].includes(model.provider.id);
}

export interface OneShotResult {
  providerId: string;
  modelId: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number; cost: number };
  session: Session;
  toolCalls: Array<{ name: string; args: unknown }>;
}

export interface OneShotStreamCallbacks {
  onStart?: (meta: { providerId: string; modelId: string }) => void;
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onToolCall?: (tool: { name: string; args: unknown }) => void;
  onToolResult?: (tool: { name: string; result: unknown }) => void;
  onFinish?: (result: OneShotResult) => void;
}

export async function resolveOneShotModel(options: {
  opts: { model?: string; provider?: string };
  providers: DetectedProvider[];
  providerRegistry: ProviderRegistry;
}): Promise<{ activeModel: ModelHandle; providerId: string; modelId: string }> {
  const { opts, providers, providerRegistry } = options;
  let providerId = opts.provider;
  let modelId = opts.model;

  if (modelId?.includes("/")) {
    const [fromProvider, fromModel] = modelId.split("/", 2);
    providerId = fromProvider;
    modelId = fromModel;
  }

  if (!providerId) {
    providerId = pickDefault(providers)?.id
      ?? opts.provider
      ?? "openai";
  }

  const activeModel = providerRegistry.createModel(providerId, modelId);
  return { activeModel, providerId, modelId: activeModel.modelId };
}

export async function runOneShotPrompt(options: {
  prompt: string;
  mode: Mode;
  providers: DetectedProvider[];
  providerRegistry: ProviderRegistry;
  opts: { model?: string; provider?: string; systemPrompt?: string; appendSystemPrompt?: string };
  streamCallbacks?: OneShotStreamCallbacks;
}): Promise<OneShotResult> {
  const { prompt, mode, providers, providerRegistry, opts, streamCallbacks } = options;
  const session = new Session();
  session.addMessage("user", prompt);
  const deterministicMeta = { providerId: "deterministic", modelId: "fastpath" };
  const applyDeterministicSessionMeta = (): { providerId: string; modelId: string } => {
    session.setProviderModel("deterministic", "fastpath");
    return deterministicMeta;
  };

  const fastPath = tryCsvToParquetFastPath(prompt) ?? tryLostGitRecoveryFastPath(prompt);
  if (fastPath) {
    const { providerId, modelId } = applyDeterministicSessionMeta();
    session.addMessage("assistant", fastPath.content);
    session.recordTurn({ toolsExposed: 0, toolsUsed: 0, visibleOutputTokens: 0, hiddenOutputTokens: 0 });
    const result = {
      providerId,
      modelId,
      content: fastPath.content,
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      session,
      toolCalls: [{ name: "deterministicFastPath", args: prompt }],
    };
    streamCallbacks?.onStart?.({ providerId: result.providerId, modelId: result.modelId });
    streamCallbacks?.onText?.(fastPath.content);
    streamCallbacks?.onFinish?.(result);
    return result;
  }

  const repoFastPath = await tryRepoTaskFastPath({ root: process.cwd(), prompt, session });
  if (repoFastPath) {
    const { providerId, modelId } = applyDeterministicSessionMeta();
    session.addMessage("assistant", repoFastPath.content);
    session.recordTurn({
      toolsExposed: 0,
      toolsUsed: 0,
      visibleOutputTokens: 0,
      hiddenOutputTokens: 0,
    });
    const result = {
      providerId,
      modelId,
      content: repoFastPath.content,
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      session,
      toolCalls: [{ name: repoFastPath.label, args: prompt }],
    };
    streamCallbacks?.onStart?.({ providerId: result.providerId, modelId: result.modelId });
    streamCallbacks?.onText?.(repoFastPath.content);
    streamCallbacks?.onFinish?.(result);
    return result;
  }

  const { activeModel, providerId, modelId } = await resolveOneShotModel({ opts, providers, providerRegistry });
  session.setProviderModel(activeModel.provider.name, modelId);

  const policy = await resolveTurnPolicy(
    prompt,
    [],
    undefined,
    activeModel.runtime === "sdk" && activeModel.model
      ? { model: activeModel.model, modelId, providerId }
      : null,
  );
  if (policy.plannerUsage) {
    session.addUsage(policy.plannerUsage.inputTokens, policy.plannerUsage.outputTokens, policy.plannerUsage.cost);
  }
  const tools = policy.allowedTools.length > 0
    ? getTools({
        include: policy.allowedTools as readonly ToolName[],
      })
    : undefined;
  const baseSystemPrompt = buildSystemPrompt(
    process.cwd(),
    providerId,
    mode,
    resolveCavemanLevel(getSettings().cavemanLevel ?? "auto", prompt),
    policy.promptProfile,
  );
  let systemPrompt = opts.systemPrompt
    ? opts.systemPrompt
    : opts.appendSystemPrompt
      ? `${baseSystemPrompt}\n\n${opts.appendSystemPrompt}`
      : baseSystemPrompt;
  const minimalOutputPolicy = getMinimalOutputPolicy({ text: prompt, policy });
  if (minimalOutputPolicy) {
    systemPrompt += `\n\n${buildMinimalOutputInstruction({
      archetype: policy.archetype,
      maxChars: minimalOutputPolicy.maxChars,
    })}`;
  }
  const baseMessages = policy.historyWindow && session.getChatMessages().length > policy.historyWindow
    ? session.getChatMessages().slice(-policy.historyWindow)
    : session.getChatMessages();
  const turnMessages = applyTurnFrame(
    baseMessages,
    prompt,
    `${policy.archetype}: ${policy.scaffold}`,
    policy.allowedTools,
  );

  let content = "";
  let usage = { inputTokens: 0, outputTokens: 0, cost: 0 };
  const toolCalls: Array<{ name: string; args: unknown }> = [];
  streamCallbacks?.onStart?.({ providerId, modelId });

  const callbacks = {
    onText: (delta: string) => {
      content += delta;
      streamCallbacks?.onText?.(delta);
    },
    onReasoning: (delta: string) => {
      streamCallbacks?.onReasoning?.(delta);
    },
    onToolCall: (name: string, args: unknown) => {
      toolCalls.push({ name, args });
      streamCallbacks?.onToolCall?.({ name, args });
    },
    onToolResult: (name: string, result: unknown) => {
      streamCallbacks?.onToolResult?.({ name, result });
    },
    onFinish: (finishUsage: { inputTokens: number; outputTokens: number; cost: number }) => {
      usage = finishUsage;
    },
    onError: (err: Error) => {
      throw err;
    },
  };

  if (activeModel.runtime === "native-cli") {
    await startNativeStream(
      {
        providerId: activeModel.provider.id as "anthropic" | "codex",
        modelId,
        system: systemPrompt,
        messages: turnMessages,
        enableThinking: getSettings().enableThinking,
        thinkingLevel: getSettings().thinkingLevel || "low",
        cwd: process.cwd(),
        structuredFinalResponse: activeModel.provider.id === "codex" && minimalOutputPolicy
          ? { maxChars: minimalOutputPolicy.maxChars }
          : null,
      },
      callbacks,
    );
  } else {
    await startStream(
      {
        model: activeModel.model as LanguageModel,
        modelId,
        system: systemPrompt,
        messages: turnMessages,
        tools: canUseSdkTools(activeModel) ? tools : undefined,
        maxToolSteps: policy.maxToolSteps,
        maxOutputTokens: minimalOutputPolicy?.maxOutputTokens,
      },
      callbacks,
    );
  }

  if (content) session.addMessage("assistant", content);
  session.addUsage(usage.inputTokens, usage.outputTokens, usage.cost);
  session.recordTurn({
    toolsExposed: canUseSdkTools(activeModel) ? policy.allowedTools.length : 0,
    toolsUsed: toolCalls.length,
    plannerCacheHit: policy.plannerCacheHit,
    plannerInputTokens: policy.plannerUsage?.inputTokens,
    plannerOutputTokens: policy.plannerUsage?.outputTokens,
    executorInputTokens: usage.inputTokens,
    executorOutputTokens: usage.outputTokens,
  });

  const result = { providerId, modelId, content, usage, session, toolCalls };
  streamCallbacks?.onFinish?.(result);
  return result;
}
