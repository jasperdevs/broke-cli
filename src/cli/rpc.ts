import type { LanguageModel } from "ai";
import { pickDefault } from "../ai/detect.js";
import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { Session } from "../core/session.js";
import { getTools } from "../tools/registry.js";
import { createSubagentTool } from "../tools/subagent.js";
import { getSettings, type Mode } from "../core/config.js";
import { loadPricing } from "../ai/cost.js";
import { ProviderRegistry } from "../ai/provider-registry.js";
import type { ModelHandle } from "../ai/providers.js";
import { loadExtensions } from "../core/extensions.js";

function canUseSdkTools(model: ModelHandle): boolean {
  return model.runtime === "sdk"
    && !!model.model
    && ["anthropic", "openai", "codex", "google", "mistral", "groq", "xai", "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm"].includes(model.provider.id);
}

export async function runRpcMode(hooks: ReturnType<typeof loadExtensions>, opts: { model?: string }): Promise<void> {
  const rpcMode: Mode = getSettings().mode;
  let abortController: AbortController | null = null;
  const providerRegistry = new ProviderRegistry();

  const [, providers] = await Promise.all([loadPricing(), providerRegistry.refresh()]);

  let providerId: string;
  let modelId: string | undefined;

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

  const currentModelId = modelId ?? activeModel.provider.defaultModel;
  const session = new Session();

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

    session.addMessage("user", msg.content);
    await hooks.emit("on_message", { role: "user", content: msg.content });

    abortController = new AbortController();
    let assistantText = "";
    const tools = getTools({
      extraTools: {
        subagent: createSubagentTool({
          cwd: () => process.cwd(),
          providerRegistry,
          getActiveModel: () => activeModel,
          getCurrentModelId: () => currentModelId,
        }),
      },
    });

    const rpcCallbacks = {
      onText: (delta: string) => {
        assistantText += delta;
        writeLine({ type: "text", content: delta });
      },
      onReasoning: () => {},
      onFinish: (usage: { inputTokens: number; outputTokens: number; cost: number }) => {
        session.addMessage("assistant", assistantText || "[empty response]");
        session.addUsage(usage.inputTokens, usage.outputTokens, usage.cost);
        writeLine({ type: "done", usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.cost } });
        abortController = null;
      },
      onError: (err: Error) => {
        writeLine({ type: "error", message: err.message.slice(0, 200) });
        session.addMessage("assistant", "[error]");
        abortController = null;
      },
    };

    const systemPrompt = buildSystemPrompt(
      process.cwd(),
      providerId,
      rpcMode,
      resolveCavemanLevel(getSettings().cavemanLevel ?? "off", msg.content),
    );

    if (activeModel.runtime === "native-cli") {
      await startNativeStream(
        {
          providerId: activeModel.provider.id as "anthropic" | "codex",
          modelId: currentModelId,
          system: systemPrompt,
          messages: session.getChatMessages(),
          abortSignal: abortController.signal,
          enableThinking: getSettings().enableThinking,
          thinkingLevel: getSettings().thinkingLevel || "low",
          yoloMode: getSettings().yoloMode,
          cwd: process.cwd(),
        },
        rpcCallbacks,
      );
    } else {
      await startStream(
        {
          model: activeModel.model as LanguageModel,
          modelId: currentModelId,
          system: systemPrompt,
          messages: session.getChatMessages(),
          tools: canUseSdkTools(activeModel) ? tools : undefined,
          abortSignal: abortController.signal,
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
