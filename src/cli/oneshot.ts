import type { LanguageModel } from "ai";
import { pickDefault, type DetectedProvider } from "../ai/detect.js";
import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { Session } from "../core/session.js";
import { getTools, type ToolName } from "../tools/registry.js";
import { createAgentTool } from "../tools/subagent.js";
import { getSettings, type Mode } from "../core/config.js";
import { getTurnPolicy } from "../core/turn-policy.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import type { ModelHandle } from "../ai/providers.js";

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
  return { activeModel, providerId, modelId: modelId ?? activeModel.provider.defaultModel };
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
  const { activeModel, providerId, modelId } = await resolveOneShotModel({ opts, providers, providerRegistry });
  const session = new Session();
  session.setProviderModel(activeModel.provider.name, modelId);
  session.addMessage("user", prompt);

  const policy = getTurnPolicy(prompt);
  const tools = policy.allowedTools.length > 0
    ? getTools({
        include: policy.allowedTools as readonly ToolName[],
        extraTools: {
          agent: createAgentTool({
            cwd: () => process.cwd(),
            providerRegistry,
            getActiveModel: () => activeModel,
            getCurrentModelId: () => modelId,
          }),
        },
      })
    : undefined;
  const baseSystemPrompt = buildSystemPrompt(
    process.cwd(),
    providerId,
    mode,
    resolveCavemanLevel(getSettings().cavemanLevel ?? "off", prompt),
    policy.promptProfile,
  );
  const systemPromptBase = opts.systemPrompt
    ? opts.systemPrompt
    : opts.appendSystemPrompt
      ? `${baseSystemPrompt}\n\n${opts.appendSystemPrompt}`
      : baseSystemPrompt;
  const systemPrompt = `${systemPromptBase}\n\nExecution scaffold (${policy.archetype}): ${policy.scaffold}`;
  const turnMessages = policy.historyWindow && session.getChatMessages().length > policy.historyWindow
    ? session.getChatMessages().slice(-policy.historyWindow)
    : session.getChatMessages();

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
        yoloMode: getSettings().yoloMode,
        cwd: process.cwd(),
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
      },
      callbacks,
    );
  }

  session.addMessage("assistant", content || "[empty response]");
  session.addUsage(usage.inputTokens, usage.outputTokens, usage.cost);
  session.recordTurn({
    toolsExposed: canUseSdkTools(activeModel) ? policy.allowedTools.length : 0,
    toolsUsed: toolCalls.length,
    plannerCacheHit: policy.plannerCacheHit,
  });

  const result = { providerId, modelId, content, usage, session, toolCalls };
  streamCallbacks?.onFinish?.(result);
  return result;
}
