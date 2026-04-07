import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { estimateTextTokens } from "../ai/tokens.js";
import { routeMessage } from "../ai/router.js";
import type { ModelHandle } from "../ai/providers.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { getTotalContextTokens } from "../core/compact.js";
import { getSettings, type Mode } from "../core/config.js";
import { shouldPreferSmallExecutor } from "../core/turn-policy.js";
import type { TurnPolicy } from "../core/turn-policy.js";
import type { ToolName } from "../tools/registry.js";
import {
  buildToolPreview,
  canUseSdkTools,
  formatTurnErrorMessage,
  looksLikeRawToolPayload,
  shouldRequestThinkTags,
  shouldSuppressPlanningNarration,
  supportsThinking,
} from "./turn-runner-support.js";
import type { Session } from "../core/session.js";
import { sendResponseNotification } from "./notify.js";

type PendingDelivery = "steering" | "followup";

interface TurnExecutionApp {
  addMessage(role: "user" | "assistant" | "system", content: string, images?: Array<{ mimeType: string; data: string }>): void;
  appendToLastMessage(delta: string): void;
  appendThinking(delta: string): void;
  setThinkingRequested(requested: boolean): void;
  getLastAssistantContent(): string;
  setStreaming(streaming: boolean): void;
  setStreamTokens(tokens: number): void;
  updateUsage(cost: number, inputTokens: number, outputTokens: number): void;
  setContextUsage(tokens: number, limit: number): void;
  setStatus(message: string): void;
  addToolCall(name: string, preview: string): void;
  updateToolCallArgs(name: string, preview: string, args?: unknown): void;
  addToolResult(name: string, result: string, error?: boolean, detail?: string): void;
  onAbortRequest(callback: () => void): void;
  hasPendingMessages(delivery?: PendingDelivery): boolean;
  flushPendingMessages(delivery: PendingDelivery): void;
}

interface ExtensionHooks {
  emit(event: string, payload: Record<string, unknown>): void;
}

export async function executeTurn(options: {
  app: TurnExecutionApp;
  session: Session;
  text: string;
  activeModel: ModelHandle;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  currentMode: Mode;
  selectedMessages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
  policy: TurnPolicy;
  effectiveImages?: Array<{ mimeType: string; data: string }>;
  buildTools: (allowedTools: readonly ToolName[]) => Record<string, unknown>;
  hooks: ExtensionHooks;
  lastToolCalls: string[];
  contextLimit: number;
  activeSystemPrompt: string;
  optimizeMessages: (messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>) => Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
}): Promise<{ nextToolCalls: string[]; lastActivityTime: number; steeringInterrupted: boolean }> {
  const {
    app,
    session,
    text,
    activeModel,
    currentModelId,
    smallModel,
    smallModelId,
    currentMode,
    selectedMessages,
    policy,
    effectiveImages,
    buildTools,
    hooks,
    lastToolCalls,
    contextLimit,
    activeSystemPrompt,
    optimizeMessages,
  } = options;

  let turnSystemPrompt = activeSystemPrompt;
  let streamedText = "";
  let streamedReasoning = "";
  let bufferedLeadText = "";
  let sawToolActivity = false;
  session.getContextOptimizer().nextTurn();

  const settings = getSettings();
  const canAutoRoute = !!smallModel
    && settings.autoRoute
    && !(activeModel.provider.id === "codex" && activeModel.runtime === "native-cli");
  const requestedRoute = canAutoRoute
    ? routeMessage(text, session.getChatMessages().length, lastToolCalls)
    : "main" as const;
  const forceSmallExecutor = canAutoRoute
    && !!smallModel
    && shouldPreferSmallExecutor(policy, session.getChatMessages().length, !!effectiveImages?.length);
  const resolvedRoute = forceSmallExecutor ? "small" : requestedRoute;
  const executionModel = resolvedRoute === "small" && smallModel ? smallModel : activeModel;
  const executionModelId = resolvedRoute === "small" && smallModel ? smallModelId : currentModelId;
  const thinkingRequested = resolvedRoute === "main"
    ? settings.enableThinking && supportsThinking(executionModel)
    : false;
  const nextToolCalls: string[] = [];
  let optimizedMessages = selectedMessages;
  let abortController: AbortController | null = new AbortController();
  let steeringInterruptRequested = false;
  const exposedToolCount = canUseSdkTools(executionModel) ? policy.allowedTools.length : 0;
  const effectiveCavemanLevel = resolveCavemanLevel(settings.cavemanLevel ?? "auto", text);

  app.onAbortRequest(() => {
    abortController?.abort();
    app.setThinkingRequested(false);
    app.setStreaming(false);
    app.addMessage("system", "Cancelled.");
    abortController = null;
  });

  if (executionModel.provider.id !== activeModel.provider.id || executionModelId !== currentModelId) {
    turnSystemPrompt = buildSystemPrompt(
      process.cwd(),
      executionModel.provider.id,
      currentMode,
      effectiveCavemanLevel,
      policy.promptProfile,
    );
    turnSystemPrompt += `\n\nExecution scaffold (${policy.archetype}): ${policy.scaffold}`;
  }
  optimizedMessages = optimizeMessages(session.getChatMessages());
  const ctxTokens = getTotalContextTokens(optimizedMessages, turnSystemPrompt, executionModelId);
  app.setContextUsage(ctxTokens, contextLimit);
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

  let nextActivityTime = Date.now();
  app.setThinkingRequested(thinkingRequested);
  const streamCallbacks = {
    onText: (delta: string) => {
      const nextText = streamedText + delta;
      if (looksLikeRawToolPayload(nextText) || shouldSuppressPlanningNarration(nextText, policy)) {
        streamedText = nextText;
        return;
      }
      if ((policy.archetype === "edit" || policy.archetype === "bugfix") && !sawToolActivity) {
        streamedText = nextText;
        bufferedLeadText += delta;
        scheduleStreamTokenUpdate();
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
      if (!sawToolActivity && bufferedLeadText.trim()) {
        app.appendToLastMessage(bufferedLeadText);
      }
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
      session.recordTurn({
        smallModel: resolvedRoute === "small",
        toolsExposed: exposedToolCount,
        toolsUsed: new Set(nextToolCalls).size,
        plannerCacheHit: policy.plannerCacheHit,
        plannerInputTokens: policy.plannerUsage?.inputTokens,
        plannerOutputTokens: policy.plannerUsage?.outputTokens,
        executorInputTokens: usage.inputTokens,
        executorOutputTokens: usage.outputTokens,
      });
      app.setStreaming(false);
      app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
      abortController = null;
      nextActivityTime = Date.now();
      if (getSettings().notifyOnResponse) sendResponseNotification();
      if (app.hasPendingMessages("steering")) app.flushPendingMessages("steering");
    },
    onError: (err: Error) => {
      flushStreamTokenUpdate();
      app.setThinkingRequested(false);
      let msg = err.message;
      const data = (err as any).data;
      if (data?.error?.message) msg = data.error.message;
      msg = formatTurnErrorMessage({
        message: msg,
        providerName: activeModel.provider.name,
        executionModelId,
      });
      session.addMessage("assistant", `[error: ${msg}]`);
      session.recordTurn({
        smallModel: resolvedRoute === "small",
        toolsExposed: exposedToolCount,
        toolsUsed: new Set(nextToolCalls).size,
        plannerCacheHit: policy.plannerCacheHit,
        plannerInputTokens: policy.plannerUsage?.inputTokens,
        plannerOutputTokens: policy.plannerUsage?.outputTokens,
      });
      app.setStreaming(false);
      app.addMessage("system", msg);
      abortController = null;
    },
    onAfterResponse: () => {},
  };

  if (executionModel.runtime === "native-cli") {
    await startNativeStream({
      providerId: executionModel.provider.id as "anthropic" | "codex",
      modelId: executionModelId,
      system: turnSystemPrompt,
      messages: optimizedMessages,
      abortSignal: abortController.signal,
      enableThinking: resolvedRoute === "main" ? getSettings().enableThinking : false,
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
      tools: canUseSdkTools(executionModel) && policy.allowedTools.length > 0
        ? buildTools(policy.allowedTools) as any
        : undefined,
      abortSignal: abortController.signal,
      enableThinking: thinkingRequested,
      thinkingLevel: getSettings().thinkingLevel || "low",
      maxToolSteps: policy.maxToolSteps,
    }, {
      ...streamCallbacks,
      onToolCallStart: (name) => {
        sawToolActivity = true;
        if (name !== "todoWrite") app.addToolCall(name, "...");
      },
      onToolCall: (name, args) => {
        sawToolActivity = true;
        hooks.emit("on_tool_call", { name, args });
        nextToolCalls.push(name);
        if (name === "todoWrite") return;
        app.updateToolCallArgs(name, buildToolPreview(name, args), args);
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
          if (readPath) session.getContextOptimizer().trackFileRead(readPath, lineCount);
        } else if (_name === "grep" && r.matches) detail = `${(r.matches as unknown[]).length} matches`;
        else if (_name === "listFiles" && r.files) detail = `${(r.files as string[]).length} files`;
        else if (_name === "agent") {
          const agent = result as { success?: boolean; model?: string; toolsUsed?: string[]; result?: string; error?: string };
          detail = [
            agent.model ? `model ${agent.model}` : "",
            agent.toolsUsed && agent.toolsUsed.length > 0 ? `tools ${agent.toolsUsed.join(", ")}` : "tools none",
          ].filter(Boolean).join(" · ");
          if (agent.success === false && agent.error) app.addToolResult(_name, agent.error.slice(0, 240), true, detail);
          else app.addToolResult(_name, (agent.result ?? "[empty agent response]").slice(0, 4000), false, detail);
          return;
        }
        if (r.success === false && r.error) app.addToolResult(_name, r.error.slice(0, 80), true);
        else app.addToolResult(_name, "ok", false, detail);
      },
      onAfterToolCall: () => {
        if (!app.hasPendingMessages("steering")) return;
        if (!abortController) return;
        steeringInterruptRequested = true;
        abortController.abort();
      },
    });
  }

  return {
    nextToolCalls,
    lastActivityTime: steeringInterruptRequested ? Date.now() : nextActivityTime,
    steeringInterrupted: steeringInterruptRequested,
  };
}
