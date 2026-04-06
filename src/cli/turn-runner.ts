import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { estimateTextTokens } from "../ai/tokens.js";
import { getContextLimit } from "../ai/cost.js";
import { routeMessage } from "../ai/router.js";
import { modelSupportsReasoning } from "../ai/model-catalog.js";
import type { ModelHandle } from "../ai/providers.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { compactMessages, getTotalContextTokens } from "../core/compact.js";
import { checkBudget } from "../core/budget.js";
import { getModelContextLimitOverride, getSettings, type Mode } from "../core/config.js";
import { getTurnPolicy } from "../core/turn-policy.js";
import { clearTodo } from "../tools/todo.js";
import type { Session } from "../core/session.js";
import { sendResponseNotification } from "./notify.js";
import { runValidationSuite } from "./auto-validate.js";
import type { ToolName } from "../tools/registry.js";

const SDK_TOOL_PROVIDER_IDS = new Set([
  "anthropic", "openai", "codex", "google", "mistral", "groq", "xai",
  "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm",
]);

function supportsThinking(model: ModelHandle): boolean {
  return modelSupportsReasoning(model.modelId, model.provider.id);
}

function shouldRequestThinkTags(model: ModelHandle, thinkingRequested: boolean): boolean {
  return thinkingRequested && supportsThinking(model) && model.runtime === "sdk";
}

function canUseSdkTools(model: ModelHandle): boolean {
  return model.runtime === "sdk" && !!model.model && SDK_TOOL_PROVIDER_IDS.has(model.provider.id);
}

function looksLikeRawToolPayload(nextText: string): boolean {
  const normalized = nextText.trimStart();
  return /^<tool_call>/i.test(normalized)
    || /^call:(writeFile|editFile|readFile|listFiles|grep|bash)\s*\{/i.test(normalized)
    || /^(writeFile|editFile|readFile|listFiles|grep|bash)\s*\(/i.test(normalized);
}

async function compactForModel(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: ModelHandle,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (model.runtime === "sdk" && model.model) {
    return compactMessages(messages, model.model);
  }
  return messages.slice(-6);
}

interface TurnRunnerApp {
  addMessage(role: "user" | "assistant" | "system", content: string, images?: Array<{ mimeType: string; data: string }>): void;
  appendToLastMessage(delta: string): void;
  appendThinking(delta: string): void;
  setThinkingRequested(requested: boolean): void;
  getLastAssistantContent(): string;
  setStreaming(streaming: boolean): void;
  setStreamTokens(tokens: number): void;
  updateUsage(cost: number, inputTokens: number, outputTokens: number): void;
  setContextUsage(tokens: number, limit: number): void;
  setCompacting(compacting: boolean, tokenCount?: number): void;
  setStatus(message: string): void;
  addToolCall(name: string, preview: string): void;
  updateToolCallArgs(name: string, preview: string, args?: unknown): void;
  addToolResult(name: string, result: string, error?: boolean, detail?: string): void;
  onAbortRequest(callback: () => void): void;
  hasPendingMessages(): boolean;
  flushPendingMessages(): void;
  getFileContexts?: () => Map<string, string>;
}

interface ExtensionHooks {
  emit(event: string, payload: Record<string, unknown>): void;
}

export async function runModelTurn(options: {
  app: TurnRunnerApp;
  session: Session;
  text: string;
  images?: Array<{ mimeType: string; data: string }>;
  activeModel: ModelHandle;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  currentMode: Mode;
  systemPrompt: string;
  buildTools: (allowedTools: readonly ToolName[]) => Record<string, unknown>;
  hooks: ExtensionHooks;
  lastToolCalls: string[];
  lastActivityTime: number;
  alreadyAddedUserMessage?: boolean;
  repairDepth?: number;
}): Promise<{ lastToolCalls: string[]; lastActivityTime: number }> {
  const { app, session, text, images, activeModel, currentModelId, smallModel, smallModelId, currentMode, systemPrompt, buildTools, hooks, lastToolCalls, lastActivityTime, alreadyAddedUserMessage, repairDepth = 0 } = options;
  const getContextOptimizer = (): ReturnType<Session["getContextOptimizer"]> => session.getContextOptimizer();
  const settings = getSettings();
  const policy = getTurnPolicy(text, lastToolCalls);

  const idleMs = Date.now() - lastActivityTime;
  if (idleMs > 5 * 60 * 1000 && session.getChatMessages().length > 4) {
    const idleMins = Math.floor(idleMs / 60000);
    session.recordIdleCacheCliff();
    app.setStatus(`idle ${idleMins}m - context cache likely expired, consider /compact`);
    if (settings.autoCompact && session.getChatMessages().length > 8) {
      try {
        const carryForward = await compactForModel(session.getChatMessages(), activeModel);
        session.replaceConversation(carryForward);
        session.recordCompaction({ freshThreadCarryForward: true });
        app.addMessage("system", `Fresh carry-forward after ${idleMins}m idle to avoid cache waste.`);
      } catch {
        // keep current transcript if carry-forward compaction fails
      }
    }
  }
  let nextActivityTime = Date.now();

  const budget = checkBudget(session.getTotalCost());
  if (!budget.allowed) {
    app.addMessage("system", budget.warning!);
    return { lastToolCalls, lastActivityTime: nextActivityTime };
  }
  if (budget.warning) app.setStatus(budget.warning);

  const chatMsgs = session.getChatMessages();
  const ctxTokens = getTotalContextTokens(chatMsgs, systemPrompt, currentModelId);
  const contextLimit = getModelContextLimitOverride(activeModel.provider.id, currentModelId)
    ?? getContextLimit(currentModelId, activeModel.provider.id)
    ?? 128000;
  const ctxPct = contextLimit > 0 ? Math.min(100, Math.round((ctxTokens / contextLimit) * 100)) : 0;
  app.setContextUsage(ctxTokens, contextLimit);

  if (settings.autoCompact && ctxPct > 80 && chatMsgs.length > 8) {
    try {
      app.setCompacting(true, ctxTokens);
      const compacted = await compactForModel(chatMsgs, activeModel);
      session.replaceConversation(compacted);
      session.recordCompaction();
      app.setCompacting(false);
      app.addMessage("system", `Auto-compacted: ${chatMsgs.length} -> ${compacted.length} messages`);
    } catch {
      app.setCompacting(false);
    }
  }

  if (!alreadyAddedUserMessage) {
    let fullText = text;
    const fileContexts = app.getFileContexts?.();
    if (fileContexts && fileContexts.size > 0) {
      const contextBlock = [...fileContexts.entries()]
        .map(([path, content]) => `--- @${path} ---\n${content}`)
        .join("\n\n");
      fullText = `${text}\n\n${contextBlock}`;
    }
    app.addMessage("user", text, images);
    session.addMessage("user", fullText, images);
  }

  app.setStreaming(true);
  clearTodo();
  let streamedText = "";
  let streamedReasoning = "";
  getContextOptimizer().nextTurn();

  const canAutoRoute = !!smallModel
    && settings.autoRoute
    && !(activeModel.provider.id === "codex" && activeModel.runtime === "native-cli");
  const route = canAutoRoute
    ? routeMessage(text, session.getChatMessages().length, lastToolCalls)
    : "main" as const;
  const useModel = route === "small" && smallModel ? smallModel : activeModel;
  const useModelId = route === "small" && smallModel ? smallModelId : currentModelId;
  const executionModel = useModel;
  const executionModelId = useModelId;
  const thinkingRequested = route === "main"
    ? getSettings().enableThinking && supportsThinking(executionModel)
    : false;
  const nextToolCalls: string[] = [];
  const optimizedMessages = getContextOptimizer().optimizeMessages(session.getChatMessages());
  let abortController: AbortController | null = new AbortController();
  let turnMetricsRecorded = false;
  const exposedToolCount = canUseSdkTools(executionModel) ? policy.allowedTools.length : 0;
  const recordTurnMetrics = () => {
    if (turnMetricsRecorded) return;
    turnMetricsRecorded = true;
    session.recordTurn({
      smallModel: route === "small",
      toolsExposed: exposedToolCount,
      toolsUsed: new Set(nextToolCalls).size,
      plannerCacheHit: policy.plannerCacheHit,
    });
  };

  app.onAbortRequest(() => {
    abortController?.abort();
    app.setThinkingRequested(false);
    app.setStreaming(false);
    app.addMessage("system", "Cancelled.");
    abortController = null;
  });

  const effectiveCavemanLevel = resolveCavemanLevel(getSettings().cavemanLevel ?? "off", text);
  let turnSystemPrompt = buildSystemPrompt(process.cwd(), executionModel.provider.id, currentMode, effectiveCavemanLevel);
  turnSystemPrompt += `\n\nExecution scaffold (${policy.archetype}): ${policy.scaffold}`;
  if (shouldRequestThinkTags(executionModel, thinkingRequested)) {
    turnSystemPrompt += "\n\nIf this model exposes reasoning in text, place that reasoning inside <think>...</think> before the final answer. Keep it plain text, concise, and specific to this request. If the model does not support that format, ignore this instruction and answer normally.";
  }
  let streamTokenFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleStreamTokenUpdate = (): void => {
    if (streamTokenFlushTimer) return;
    streamTokenFlushTimer = setTimeout(() => {
      streamTokenFlushTimer = null;
      app.setStreamTokens(estimateTextTokens(streamedText + streamedReasoning, executionModelId));
    }, 80);
  };
  const flushStreamTokenUpdate = (): void => {
    if (streamTokenFlushTimer) clearTimeout(streamTokenFlushTimer);
    streamTokenFlushTimer = null;
    app.setStreamTokens(estimateTextTokens(streamedText + streamedReasoning, executionModelId));
  };

  app.setThinkingRequested(thinkingRequested);
  const streamCallbacks = {
    onText: (delta: string) => {
      const nextText = streamedText + delta;
      if (looksLikeRawToolPayload(nextText)) {
        streamedText = nextText;
        return;
      }
      app.appendToLastMessage(delta);
      streamedText = nextText;
      scheduleStreamTokenUpdate();
    },
    onReasoning: (delta: string) => {
      app.appendThinking(delta);
      streamedReasoning += delta;
      scheduleStreamTokenUpdate();
    },
    onFinish: (usage: { inputTokens: number; outputTokens: number; cost: number }) => {
      flushStreamTokenUpdate();
      app.setThinkingRequested(false);
      const content = app.getLastAssistantContent();
      if (content) {
        session.addMessage("assistant", content);
      } else if (looksLikeRawToolPayload(streamedText)) {
        session.addMessage("assistant", "[raw tool payload hidden]");
        app.addMessage("system", "Model emitted raw tool syntax. Hidden from chat.");
      } else {
        session.addMessage("assistant", "[empty response]");
        app.addMessage("system", "No response from model. Try again or switch models with /model.");
      }
      session.addUsage(usage.inputTokens, usage.outputTokens, usage.cost);
      recordTurnMetrics();
      app.setStreaming(false);
      app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
      abortController = null;
      nextActivityTime = Date.now();
      if (getSettings().notifyOnResponse) sendResponseNotification();
    },
    onError: (err: Error) => {
      flushStreamTokenUpdate();
      app.setThinkingRequested(false);
      let msg = err.message;
      const data = (err as any).data;
      if (data?.error?.message) msg = data.error.message;
      if (msg.includes("insufficient permissions") || msg.includes("Missing scopes")) msg = "Your API key doesn't have access to this model. Try a different model with /model.";
      else if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key") || msg.includes("401")) msg = `Invalid API key for ${activeModel.provider.name}. Check your key and try again.`;
      else if (msg.includes("Could not resolve") || msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) msg = `Can't reach ${activeModel.provider.name}. Check your connection or if the server is running.`;
      else if (msg.includes("429") || msg.includes("rate_limit") || msg.includes("hit your limit")) msg = "Rate limited. Wait a moment and try again.";
      else if (msg.includes("is not supported when using Codex with a ChatGPT account")) {
        msg = `Codex ChatGPT login does not support model "${executionModelId}". Use a supported GPT-5 model, or turn off Auto-route for Codex native login.`;
      } else if (msg.includes("model_not_found") || msg.includes("does not exist") || msg.includes("not found")) msg = `Model "${executionModelId}" not available. Try /model to pick a different one.`;
      else if (msg.includes("overloaded") || msg.includes("503") || msg.includes("529")) msg = `${activeModel.provider.name} is overloaded right now. Try again in a moment.`;
      if (msg.length > 300) msg = `${msg.slice(0, 297)}...`;
      session.addMessage("assistant", `[error: ${msg}]`);
      recordTurnMetrics();
      app.setStreaming(false);
      app.addMessage("system", msg);
      abortController = null;
    },
    onAfterResponse: () => {
      if (getSettings().followUpMode === "after_response" && app.hasPendingMessages()) app.flushPendingMessages();
    },
  };

  if (executionModel.runtime === "native-cli") {
    await startNativeStream({
      providerId: executionModel.provider.id as "anthropic" | "codex",
      modelId: executionModelId,
      system: turnSystemPrompt,
      messages: optimizedMessages,
      abortSignal: abortController.signal,
      enableThinking: route === "main" ? getSettings().enableThinking : false,
      thinkingLevel: getSettings().thinkingLevel || "low",
      yoloMode: getSettings().yoloMode,
      cwd: process.cwd(),
    }, streamCallbacks);
  } else {
    await startStream({
      model: executionModel.model!,
      modelId: executionModelId,
      providerId: executionModel.provider.id,
      system: turnSystemPrompt,
      messages: optimizedMessages,
      tools: canUseSdkTools(executionModel) ? buildTools(policy.allowedTools) as any : undefined,
      abortSignal: abortController.signal,
      enableThinking: thinkingRequested,
      thinkingLevel: getSettings().thinkingLevel || "low",
      maxToolSteps: policy.maxToolSteps,
    }, {
      ...streamCallbacks,
      onToolCallStart: (name) => {
        if (name !== "todoWrite") app.addToolCall(name, "...");
      },
      onToolCall: (name, args) => {
        hooks.emit("on_tool_call", { name, args });
        nextToolCalls.push(name);
        if (name === "todoWrite") return;
        let preview = "";
        if (name === "writeFile" || name === "editFile") preview = (args as any)?.path ?? "?";
        else if (name === "readFile" || name === "listFiles" || name === "grep") preview = (args as any)?.path ?? (args as any)?.pattern ?? "?";
        else if (name === "bash") {
          const cmd = (args as any)?.command ?? "?";
          preview = cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd;
        } else preview = typeof args === "object" ? JSON.stringify(args).slice(0, 50) : String(args).slice(0, 50);
        app.updateToolCallArgs(name, preview, args);
      },
      onToolResult: (_name, result) => {
        hooks.emit("on_tool_result", { name: _name, result });
        if (_name === "todoWrite") return;
        const r = result as { success?: boolean; output?: string; error?: string; content?: string; matches?: unknown[]; files?: string[] };
        let detail: string | undefined;
        if (_name === "bash" && r.output) detail = r.output.slice(0, 200);
        else if (_name === "readFile" && r.content) {
          const lineCount = r.content.split("\n").length;
          detail = `${lineCount} lines`;
          const readPath = (result as any)?.path ?? "";
          if (readPath) getContextOptimizer().trackFileRead(readPath, lineCount);
        } else if (_name === "grep" && r.matches) detail = `${(r.matches as unknown[]).length} matches`;
        else if (_name === "listFiles" && r.files) detail = `${(r.files as string[]).length} files`;
        if (r.success === false && r.error) app.addToolResult(_name, r.error.slice(0, 80), true);
        else app.addToolResult(_name, "ok", false, detail);
      },
      onAfterToolCall: () => {
        if (getSettings().followUpMode === "after_tool" && app.hasPendingMessages()) app.flushPendingMessages();
      },
    });
  }

  const validation = runValidationSuite(nextToolCalls.some((name) => name === "writeFile" || name === "editFile"));
  if (validation.attempted) {
    app.addMessage("system", validation.report);
    if (validation.failed && getSettings().autoFixValidation && repairDepth < 1) {
      app.addMessage("system", "Validation failed - attempting one repair pass.");
      return runModelTurn({
        ...options,
        text: `Fix the validation failures from the last edit. Here is the validation output:\n\n${validation.report}`,
        images: undefined,
        activeModel,
        currentModelId,
        smallModel,
        smallModelId,
        currentMode,
        systemPrompt,
        buildTools,
        hooks,
        lastToolCalls: nextToolCalls,
        lastActivityTime: nextActivityTime,
        alreadyAddedUserMessage: false,
        repairDepth: repairDepth + 1,
      });
    }
  }

  return { lastToolCalls: nextToolCalls, lastActivityTime: nextActivityTime };
}
