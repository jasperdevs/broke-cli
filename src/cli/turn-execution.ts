import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { estimateTextTokens } from "../ai/tokens.js";
import type { ModelHandle } from "../ai/providers.js";
import { rewriteAssistantForCaveman } from "../core/caveman.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { getTotalContextTokens } from "../core/compact.js";
import { getSettings, type Mode } from "../core/config.js";
import type { TurnPolicy } from "../core/turn-policy.js";
import type { ToolName } from "../tools/registry.js";
import {
  buildToolPreview,
  canUseSdkTools,
  formatTurnErrorMessage,
  looksLikeRawToolPayload,
  resolveExecutionTarget,
  shouldEnforceToolFirstTurn,
  shouldRequestThinkTags,
  shouldSuppressPlanningNarration,
} from "./turn-runner-support.js";
import type { Session } from "../core/session.js";
import { sendResponseNotification } from "./notify.js";
import type { SpecialistModelRole } from "./model-routing.js";

type PendingDelivery = "steering" | "followup";

interface TurnExecutionApp {
  addMessage(role: "user" | "assistant" | "system", content: string, images?: Array<{ mimeType: string; data: string }>): void;
  appendToLastMessage(delta: string): void;
  replaceLastAssistantMessage?(content: string): void;
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
  rollbackLastAssistantMessage(): void;
}

interface ExtensionHooks {
  emit(event: string, payload: Record<string, unknown>): void;
}

const MAX_TOOL_RESULT_SERIALIZED_CHARS = 6000;

function createStreamTokenTracker(
  app: TurnExecutionApp,
  executionModelId: string,
  getText: () => string,
): {
  schedule: () => void;
  flush: () => void;
} {
  let streamTokenFlushTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule: () => {
      if (streamTokenFlushTimer) return;
      streamTokenFlushTimer = setTimeout(() => {
        streamTokenFlushTimer = null;
        app.setStreamTokens(estimateTextTokens(getText(), executionModelId));
      }, 80);
    },
    flush: () => {
      if (streamTokenFlushTimer) clearTimeout(streamTokenFlushTimer);
      streamTokenFlushTimer = null;
      app.setStreamTokens(estimateTextTokens(getText(), executionModelId));
    },
  };
}

function resolveTurnExecution(options: {
  text: string;
  policy: TurnPolicy;
  currentMode: Mode;
  session: Session;
  lastToolCalls: string[];
  forceRoute?: "main" | "small";
  activeModel: ModelHandle;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  effectiveImages?: Array<{ mimeType: string; data: string }>;
  contextLimit: number;
  activeSystemPrompt: string;
  optimizeMessages: (messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>) => Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
  app: Pick<TurnExecutionApp, "setContextUsage">;
  resolveSpecialistModel?: (role: SpecialistModelRole) => { model: ModelHandle; modelId: string } | null;
}): {
  turnSystemPrompt: string;
  optimizedMessages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
  resolvedRoute: "main" | "small";
  executionModel: ModelHandle;
  executionModelId: string;
  thinkingRequested: boolean;
} {
  const {
    text,
    policy,
    currentMode,
    session,
    lastToolCalls,
    forceRoute,
    activeModel,
    currentModelId,
    smallModel,
    smallModelId,
    effectiveImages,
    contextLimit,
    activeSystemPrompt,
    optimizeMessages,
    app,
    resolveSpecialistModel,
  } = options;
  let turnSystemPrompt = activeSystemPrompt;
  const {
    resolvedRoute,
    executionModel,
    executionModelId,
    thinkingRequested,
  } = resolveExecutionTarget({
    text,
    policy,
    currentMode,
    sessionMessageCount: session.getChatMessages().length,
    lastToolCalls,
    forceRoute,
    activeModel,
    currentModelId,
    smallModel,
    smallModelId,
    effectiveImages,
    resolveSpecialistModel,
  });
  if (executionModel.provider.id !== activeModel.provider.id || executionModelId !== currentModelId) {
    turnSystemPrompt = buildSystemPrompt(
      process.cwd(),
      executionModel.provider.id,
      currentMode,
      resolveCavemanLevel(getSettings().cavemanLevel ?? "auto", text),
      policy.promptProfile,
    );
    turnSystemPrompt += `\n\nExecution scaffold (${policy.archetype}): ${policy.scaffold}`;
  }
  const optimizedMessages = optimizeMessages(session.getChatMessages());
  const ctxTokens = getTotalContextTokens(optimizedMessages, turnSystemPrompt, executionModelId);
  app.setContextUsage(ctxTokens, contextLimit);
  return {
    turnSystemPrompt,
    optimizedMessages,
    resolvedRoute,
    executionModel,
    executionModelId,
    thinkingRequested,
  };
}

function estimateToolResultTokens(result: unknown): number {
  try {
    const serialized = JSON.stringify(result);
    if (!serialized) return 0;
    const capped = serialized.length > MAX_TOOL_RESULT_SERIALIZED_CHARS
      ? `${serialized.slice(0, MAX_TOOL_RESULT_SERIALIZED_CHARS)}…`
      : serialized;
    return estimateTextTokens(capped);
  } catch {
    return 0;
  }
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
  policy: TurnPolicy;
  effectiveImages?: Array<{ mimeType: string; data: string }>;
  buildTools: (allowedTools: readonly ToolName[]) => Record<string, unknown>;
  hooks: ExtensionHooks;
  lastToolCalls: string[];
  contextLimit: number;
  activeSystemPrompt: string;
  optimizeMessages: (messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>) => Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
  forceRoute?: "main" | "small";
  resolveSpecialistModel?: (role: SpecialistModelRole) => { model: ModelHandle; modelId: string } | null;
}): Promise<{
  nextToolCalls: string[];
  lastActivityTime: number;
  steeringInterrupted: boolean;
  resolvedRoute: "main" | "small";
  completion: "success" | "empty" | "error" | "insufficient";
  toolActivity: boolean;
  assistantText: string;
  errorMessage?: string;
}> {
  const {
    app,
    session,
    text,
    activeModel,
    currentModelId,
    smallModel,
    smallModelId,
    currentMode,
    policy,
    effectiveImages,
    buildTools,
    hooks,
    lastToolCalls,
    contextLimit,
    activeSystemPrompt,
    optimizeMessages,
    forceRoute,
    resolveSpecialistModel,
  } = options;

  let streamedText = "";
  let streamedReasoning = "";
  let sawToolActivity = false;
  session.getContextOptimizer().nextTurn();

  const settings = getSettings();
  const {
    turnSystemPrompt: initialTurnSystemPrompt,
    optimizedMessages,
    resolvedRoute,
    executionModel,
    executionModelId,
    thinkingRequested,
  } = resolveTurnExecution({
    text,
    policy,
    currentMode,
    session,
    lastToolCalls,
    forceRoute,
    activeModel,
    currentModelId,
    smallModel,
    smallModelId,
    effectiveImages,
    contextLimit,
    activeSystemPrompt,
    optimizeMessages,
    app,
    resolveSpecialistModel,
  });
  let turnSystemPrompt = initialTurnSystemPrompt;
  const nextToolCalls: string[] = [];
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

  if (shouldRequestThinkTags(executionModel, thinkingRequested)) {
    turnSystemPrompt += "\n\nIf this model exposes reasoning in text, place that reasoning inside <think>...</think> before the final answer. Keep it plain text, concise, and specific to this request. If the model does not support that format, ignore this instruction and answer normally.";
  }

  let completion: "success" | "empty" | "error" | "insufficient" = "success";
  let errorMessage: string | undefined;
  const streamTokenTracker = createStreamTokenTracker(app, executionModelId, () => streamedText + streamedReasoning);
  let nextActivityTime = Date.now();
  app.setThinkingRequested(thinkingRequested);
  const streamCallbacks = {
    onText: (delta: string) => {
      const nextText = streamedText + delta;
      if (looksLikeRawToolPayload(nextText) || shouldSuppressPlanningNarration(nextText, policy)) {
        streamedText = nextText;
        return;
      }
      app.appendToLastMessage(delta);
      streamedText = nextText;
      streamTokenTracker.schedule();
    },
    onReasoning: (delta: string) => {
      app.appendThinking(delta);
      streamedReasoning += delta;
      streamTokenTracker.schedule();
    },
    onFinish: (usage: { inputTokens: number; outputTokens: number; cost: number }) => {
      streamTokenTracker.flush();
      app.setThinkingRequested(false);
      let content = streamedText.trim();
      if (effectiveCavemanLevel !== "off" && content) {
        const compressed = rewriteAssistantForCaveman(content, effectiveCavemanLevel);
        if (compressed && compressed !== content) {
          app.replaceLastAssistantMessage?.(compressed);
          content = compressed;
        }
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
      if (shouldEnforceToolFirstTurn({
        text,
        assistantText: content,
        toolActivity: sawToolActivity || nextToolCalls.length > 0,
        policy,
        model: executionModel,
      })) {
        app.rollbackLastAssistantMessage();
        completion = "insufficient";
        return;
      }
      if (content) {
        session.addMessage("assistant", content);
        if (getSettings().notifyOnResponse) sendResponseNotification();
        if (app.hasPendingMessages("steering")) app.flushPendingMessages("steering");
        completion = "success";
        return;
      }
      if (resolvedRoute === "small" && !sawToolActivity) {
        completion = "empty";
        return;
      }
      if (looksLikeRawToolPayload(streamedText)) {
        session.addMessage("assistant", "[raw tool payload hidden]");
        app.addMessage("system", "Model emitted raw tool syntax. Hidden from chat.");
      } else {
        session.addMessage("assistant", "[empty response]");
        app.addMessage("system", "No response from model. Try again or switch models with /model.");
      }
      if (getSettings().notifyOnResponse) sendResponseNotification();
      if (app.hasPendingMessages("steering")) app.flushPendingMessages("steering");
      completion = "empty";
    },
    onError: (err: Error) => {
      streamTokenTracker.flush();
      app.setThinkingRequested(false);
      let msg = err.message;
      const data = (err as any).data;
      if (data?.error?.message) msg = data.error.message;
      msg = formatTurnErrorMessage({
        message: msg,
        providerName: activeModel.provider.name,
        executionModelId,
      });
      session.recordTurn({
        smallModel: resolvedRoute === "small",
        toolsExposed: exposedToolCount,
        toolsUsed: new Set(nextToolCalls).size,
        plannerCacheHit: policy.plannerCacheHit,
        plannerInputTokens: policy.plannerUsage?.inputTokens,
        plannerOutputTokens: policy.plannerUsage?.outputTokens,
      });
      app.setStreaming(false);
      abortController = null;
      errorMessage = msg;
      completion = "error";
      if (!(resolvedRoute === "small" && !sawToolActivity)) {
        session.addMessage("assistant", `[error: ${msg}]`);
        app.addMessage("system", msg);
      }
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
        session.recordToolResult(_name, estimateToolResultTokens(result));
        const r = result as { success?: boolean; output?: string; error?: string; content?: string; matches?: unknown[]; files?: string[] };
        let detail: string | undefined;
        if (_name === "bash") {
          const reroutedTo = (result as any)?.reroutedTo as string | undefined;
          if ((result as any)?.rerouted) session.recordShellRecovery();
          if (reroutedTo === "readFile") {
            const totalLines = (result as any)?.totalLines;
            detail = totalLines ? `via readFile · ${totalLines} lines` : "via readFile";
          } else if (reroutedTo === "listFiles") {
            const fileCount = (result as any)?.fileCount;
            detail = fileCount ? `via listFiles · ${fileCount} files` : "via listFiles";
          } else if (reroutedTo === "grep") {
            const matchCount = (result as any)?.matchCount;
            detail = matchCount !== undefined ? `via grep · ${matchCount} matches` : "via grep";
          } else if (r.output) {
            detail = r.output.slice(0, 200);
          }
        }
        else if (_name === "readFile" && r.content) {
          const lineCount = r.content.split("\n").length;
          detail = `${lineCount} lines`;
          const readPath = (result as any)?.path ?? "";
          if (readPath) session.getContextOptimizer().trackFileRead(readPath, lineCount);
        } else if (_name === "grep" && r.matches) {
          const capped = (result as any)?.capped;
          detail = `${(r.matches as unknown[]).length} matches${capped ? " capped" : ""}`;
        } else if (_name === "listFiles" && r.files) {
          const totalEntries = (result as any)?.totalEntries;
          const shown = (r.files as string[]).length;
          detail = totalEntries && totalEntries > shown ? `${shown}/${totalEntries} entries` : `${shown} entries`;
        }
        else if (_name === "semSearch") detail = `${((result as any)?.results as unknown[] | undefined)?.length ?? 0} ranked hits`;
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
    resolvedRoute,
    completion,
    toolActivity: sawToolActivity || nextToolCalls.length > 0,
    assistantText: streamedText.trim(),
    errorMessage,
  };
}
