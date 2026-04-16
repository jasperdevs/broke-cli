import type { LanguageModel } from "ai";
import { pickDefault } from "../ai/detect.js";
import { startGoogleCloudCodeStream } from "../ai/google-cloud-code-stream.js";
import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { Session } from "../core/session.js";
import { getTools } from "../tools/registry.js";
import { getSettings, type Mode } from "../core/config.js";
import { getProviderCredential } from "../core/provider-credentials.js";
import { resolveTurnPolicy } from "../core/turn-policy.js";
import { loadPricing } from "../ai/cost.js";
import { ProviderRegistry } from "../ai/provider-registry.js";
import type { ModelHandle } from "../ai/providers.js";
import { loadExtensions } from "../core/extensions.js";
import type { ToolName } from "../tools/registry.js";
import { tryRepoTaskFastPath } from "./repo-fastpath.js";
import { applyTurnFrame } from "./turn-frame.js";
import { buildMinimalOutputInstruction, getMinimalOutputPolicy } from "./turn-runner-support.js";
import { getProviderCompat } from "../ai/provider-compat.js";
import { formatWorkspaceScopeError, resolveWorkspaceScope } from "../core/permissions.js";

function canUseSdkTools(model: ModelHandle): boolean {
  return model.runtime === "sdk"
    && !!model.model
    && ["anthropic", "openai", "codex", "google", "mistral", "groq", "xai", "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm"].includes(model.provider.id)
    && getProviderCompat(model.provider.id, model.modelId).supportsTools !== false;
}

export async function runRpcMode(hooks: ReturnType<typeof loadExtensions>, opts: { model?: string; provider?: string; systemPrompt?: string; appendSystemPrompt?: string }): Promise<void> {
  const rpcMode: Mode = getSettings().mode;
  let abortController: AbortController | null = null;
  const providerRegistry = new ProviderRegistry();

  const [, providers] = await Promise.all([loadPricing(), providerRegistry.refresh()]);

  let providerId: string;
  let modelId: string | undefined;

  if (opts.model?.includes(":")) {
    opts.model = opts.model.split(":")[0];
  }

  if (opts.model) {
    const parts = opts.model.split("/");
    if (parts.length === 2) {
      providerId = parts[0];
      modelId = parts[1];
    } else {
      const def = pickDefault(providers);
      providerId = def?.id ?? "openai";
      modelId = opts.model;
    }
  } else {
    const def = pickDefault(providers);
    if (!def) {
      process.stdout.write(JSON.stringify({ type: "error", message: "No providers found" }) + "\n");
      process.exit(1);
      return;
    }
    providerId = def.id;
  }

  let activeModel: ModelHandle;
  try {
    activeModel = providerRegistry.createModel(providerId, modelId);
  } catch (err) {
    process.stdout.write(JSON.stringify({ type: "error", message: (err as Error).message }) + "\n");
    process.exit(1);
    return;
  }

  const currentModelId = activeModel.modelId;
  const session = new Session();
  session.setProviderModel(activeModel.provider.name, currentModelId);

  await hooks.emit("on_session_start", { cwd: process.cwd(), rpc: true });

  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin });

  function writeLine(obj: object): void {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }

  for await (const line of rl) {
    let msg: { type: string; content?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      writeLine({ type: "error", message: "Invalid JSON" });
      continue;
    }

    if (msg.type === "abort") {
      abortController?.abort();
      abortController = null;
      continue;
    }

    if (msg.type !== "message" || !msg.content) {
      writeLine({ type: "error", message: 'Expected {"type":"message", "content":"..."}' });
      continue;
    }

    const workspace = resolveWorkspaceScope(process.cwd());
    if (!workspace.allowed) {
      writeLine({ type: "error", message: formatWorkspaceScopeError(workspace) });
      continue;
    }

    session.addMessage("user", msg.content);
    await hooks.emit("on_message", { role: "user", content: msg.content });

    const repoFastPath = await tryRepoTaskFastPath({ root: process.cwd(), prompt: msg.content, session });
    if (repoFastPath) {
      session.addMessage("assistant", repoFastPath.content);
      session.recordTurn({ toolsExposed: 0, toolsUsed: 0, visibleOutputTokens: 0, hiddenOutputTokens: 0 });
      writeLine({ type: "text", content: repoFastPath.content });
      writeLine({ type: "done", usage: { inputTokens: 0, outputTokens: 0, cost: 0 } });
      continue;
    }

    abortController = new AbortController();
    let assistantText = "";
    const policy = await resolveTurnPolicy(
      msg.content,
      [],
      session.getRepoState(),
      activeModel.runtime === "sdk" && activeModel.model
        ? { model: activeModel.model, modelId: currentModelId, providerId: activeModel.provider.id }
        : null,
    );
    if (policy.plannerUsage) {
      session.addUsage(policy.plannerUsage.inputTokens, policy.plannerUsage.outputTokens, policy.plannerUsage.cost);
    }
    const tools = policy.allowedTools.length > 0
      ? getTools({
          include: policy.allowedTools as readonly ToolName[],
          extraTools: hooks.getTools() as any,
          cwd: process.cwd(),
        })
      : undefined;

    const rpcCallbacks = {
      onText: (delta: string) => {
        assistantText += delta;
        writeLine({ type: "text", content: delta });
      },
      onReasoning: () => {},
      onFinish: (usage: { inputTokens: number; outputTokens: number; cost: number }) => {
        if (assistantText) session.addMessage("assistant", assistantText);
        session.addUsage(usage.inputTokens, usage.outputTokens, usage.cost);
        session.recordTurn({
          toolsExposed: canUseSdkTools(activeModel) ? policy.allowedTools.length : 0,
          plannerCacheHit: policy.plannerCacheHit,
          plannerInputTokens: policy.plannerUsage?.inputTokens,
          plannerOutputTokens: policy.plannerUsage?.outputTokens,
          executorInputTokens: usage.inputTokens,
          executorOutputTokens: usage.outputTokens,
        });
        writeLine({ type: "done", usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.cost } });
        abortController = null;
      },
      onError: (err: Error) => {
        writeLine({ type: "error", message: err.message.slice(0, 200) });
        session.addMessage("assistant", "[error]");
        session.recordTurn({
          toolsExposed: canUseSdkTools(activeModel) ? policy.allowedTools.length : 0,
          plannerCacheHit: policy.plannerCacheHit,
          plannerInputTokens: policy.plannerUsage?.inputTokens,
          plannerOutputTokens: policy.plannerUsage?.outputTokens,
        });
        abortController = null;
      },
    };

    const baseSystemPrompt = buildSystemPrompt(
      process.cwd(),
      providerId,
      rpcMode,
      resolveCavemanLevel(getSettings().cavemanLevel ?? "auto", msg.content),
      policy.promptProfile,
    );
    let systemPrompt = opts.systemPrompt
      ? opts.systemPrompt
      : opts.appendSystemPrompt
        ? `${baseSystemPrompt}\n\n${opts.appendSystemPrompt}`
        : baseSystemPrompt;
    const minimalOutputPolicy = getMinimalOutputPolicy({ text: msg.content, policy });
    if (minimalOutputPolicy) {
      systemPrompt += `\n\n${buildMinimalOutputInstruction({
        archetype: policy.archetype,
      })}`;
    }
    const baseMessages = policy.historyWindow && session.getChatMessages().length > policy.historyWindow
      ? session.getChatMessages().slice(-policy.historyWindow)
      : session.getChatMessages();
    const turnMessages = applyTurnFrame(
      baseMessages,
      msg.content,
      `${policy.archetype}: ${policy.scaffold}`,
      policy.allowedTools,
    );

    if (activeModel.runtime === "native-cli") {
      await startNativeStream(
        {
          providerId: activeModel.provider.id as "anthropic" | "codex",
          modelId: currentModelId,
          system: systemPrompt,
          messages: turnMessages,
          abortSignal: abortController.signal,
          enableThinking: getSettings().enableThinking,
          thinkingLevel: getSettings().thinkingLevel || "low",
          cwd: process.cwd(),
          structuredFinalResponse: null,
        },
        rpcCallbacks,
      );
    } else if (activeModel.runtime === "oauth-stream") {
      const credential = getProviderCredential(activeModel.provider.id);
      await startGoogleCloudCodeStream(
        {
          providerId: activeModel.provider.id as "google-gemini-cli" | "google-antigravity",
          modelId: currentModelId,
          credential: credential.value ?? "",
          system: systemPrompt,
          messages: turnMessages,
          abortSignal: abortController.signal,
          maxOutputTokens: minimalOutputPolicy?.maxOutputTokens,
        },
        rpcCallbacks,
      );
    } else {
      await startStream(
        {
          model: activeModel.model as LanguageModel,
          modelId: currentModelId,
          system: systemPrompt,
          messages: turnMessages,
          tools: canUseSdkTools(activeModel) ? tools : undefined,
          abortSignal: abortController.signal,
          maxToolSteps: policy.maxToolSteps,
          maxOutputTokens: minimalOutputPolicy?.maxOutputTokens,
        },
        {
          ...rpcCallbacks,
          onToolCall: (name, args) => {
            hooks.emit("on_tool_call", { name, args });
            writeLine({ type: "tool_call", name, args });
          },
          onToolResult: (_name, result) => {
            hooks.emit("on_tool_result", { name: _name, result });
            writeLine({ type: "tool_result", name: _name, result });
          },
        },
      );
    }
  }

  await hooks.emit("on_session_end", { cost: session.getTotalCost(), tokens: session.getTotalTokens() });
}
