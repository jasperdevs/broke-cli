import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { estimateTextTokens } from "../ai/tokens.js";
import type { ModelHandle } from "../ai/providers.js";
import { observeToolResult } from "./turn-tool-observer.js";
import { rewriteAssistantForCaveman } from "../core/caveman.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { getTotalContextTokens } from "../core/compact.js";
import { getSettings, type Mode } from "../core/config.js";
import type { TurnPolicy } from "../core/turn-policy.js";
import type { ToolName } from "../tools/registry.js";
import { setActiveToolContext } from "../tools/runtime-context.js";
import {
  buildToolPreview,
  buildMinimalOutputInstruction,
  canUseSdkTools,
  formatTurnErrorMessage,
  getMinimalOutputPolicy,
  looksLikeRawToolPayload,
  resolveExecutionTarget,
  shouldEnforceToolFirstTurn,
  shouldRequestThinkTags,
  shouldSuppressPlanningNarration,
} from "./turn-runner-support.js";
import type { Session } from "../core/session.js";
import { sendResponseNotification } from "./notify.js";
import type { SpecialistModelRole } from "./model-routing.js";
import { createLiveToolCallbacks } from "./turn-tool-callbacks.js";
import { applyTurnFrame } from "./turn-frame.js";
import { injectTransientUserContext } from "./turn-runner-stages.js";
import { createStreamTokenTracker } from "./stream-token-tracker.js";
import { executeRawToolPayloadFallback } from "./raw-tool-fallback.js";
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

interface ExtensionHooks { emit(event: string, payload: Record<string, unknown>): void; }
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
  transientUserContext?: string;
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
    transientUserContext,
    app,
    resolveSpecialistModel,
  } = options;
  let turnSystemPrompt = activeSystemPrompt;
  const { resolvedRoute, executionModel, executionModelId, thinkingRequested } = resolveExecutionTarget({
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
  }
  const optimizedMessages = applyTurnFrame(
    injectTransientUserContext(optimizeMessages(session.getChatMessages()), transientUserContext),
    text,
    `${policy.archetype}: ${policy.scaffold}`,
    policy.allowedTools,
  );
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
  transientUserContext?: string;
  preparedSpend?: {
    systemPromptTokens: number;
    replayInputTokens: number;
    stateCarrierTokens: number;
    transientContextTokens: number;
  };
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
    transientUserContext,
    preparedSpend,
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
    transientUserContext,
    app,
    resolveSpecialistModel,
  });
  let turnSystemPrompt = initialTurnSystemPrompt;
  const nextToolCalls: string[] = [];
  let abortController: AbortController | null = new AbortController();
  let steeringInterruptRequested = false;
  const exposedToolCount = canUseSdkTools(executionModel) ? policy.allowedTools.length : 0;
  const effectiveCavemanLevel = resolveCavemanLevel(settings.cavemanLevel ?? "auto", text);
  const minimalOutputPolicy = getMinimalOutputPolicy({ text, policy, modelRuntime: executionModel.runtime });

  if (minimalOutputPolicy) {
    turnSystemPrompt += `\n\n${buildMinimalOutputInstruction({
      archetype: policy.archetype,
      maxChars: minimalOutputPolicy.maxChars,
    })}`;
  }

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
  let rawToolPayloadText: string | null = null;
  const streamTokenTracker = createStreamTokenTracker(app.setStreamTokens.bind(app), executionModelId, () => streamedText + streamedReasoning);
  let nextActivityTime = Date.now();
  const lastToolArgsByName = new Map<string, unknown>();
  const liveToolCallbacks = createLiveToolCallbacks({
    app,
    hooks,
    session,
    nextToolCalls,
    lastToolArgsByName,
    onToolActivity: () => { sawToolActivity = true; },
    onSteeringInterrupt: () => {
      if (!abortController) return;
      steeringInterruptRequested = true;
      abortController.abort();
    },
    buildToolPreview,
  });
  app.setThinkingRequested(thinkingRequested);
  setActiveToolContext({
    contextOptimizer: session.getContextOptimizer(),
    memoizedToolResults: getSettings().memoizeToolResults !== false,
  });

  const streamCallbacks = {
    onText: (delta: string) => {
      const nextText = streamedText + delta;
      if (looksLikeRawToolPayload(nextText) || shouldSuppressPlanningNarration(nextText, policy, executionModel.runtime)) {
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
        systemPromptTokens: preparedSpend?.systemPromptTokens,
        replayInputTokens: preparedSpend?.replayInputTokens,
        stateCarrierTokens: preparedSpend?.stateCarrierTokens,
        transientContextTokens: preparedSpend?.transientContextTokens,
        visibleOutputTokens: estimateTextTokens(content, executionModelId),
        hiddenOutputTokens: Math.max(0, usage.outputTokens - estimateTextTokens(content, executionModelId)),
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
      if (looksLikeRawToolPayload(content)) {
        app.rollbackLastAssistantMessage();
        rawToolPayloadText = content;
        completion = "empty";
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
        app.rollbackLastAssistantMessage();
        rawToolPayloadText = streamedText.trim();
      } else {
        app.addMessage("system", `No response from ${executionModel.provider.name}/${executionModelId}. Try again or switch models with /model.`);
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
        systemPromptTokens: preparedSpend?.systemPromptTokens,
        replayInputTokens: preparedSpend?.replayInputTokens,
        stateCarrierTokens: preparedSpend?.stateCarrierTokens,
        transientContextTokens: preparedSpend?.transientContextTokens,
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

  try {
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
        structuredFinalResponse: executionModel.provider.id === "codex" && minimalOutputPolicy
          ? { maxChars: minimalOutputPolicy.maxChars }
          : null,
      }, { ...streamCallbacks, ...liveToolCallbacks });
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
        maxOutputTokens: minimalOutputPolicy?.maxOutputTokens,
      }, {
        ...streamCallbacks,
        ...liveToolCallbacks,
      });
    }
  } finally {
    setActiveToolContext(null);
  }

  if (rawToolPayloadText) {
    const fallback = await executeRawToolPayloadFallback({
      rawToolPayloadText,
      text,
      executionModel,
      policyAllowedTools: policy.allowedTools,
      buildTools,
      app,
      hooks,
      session,
      nextToolCalls,
      abortSignal: abortController?.signal,
    });
    if (fallback.handled && fallback.summary) {
      sawToolActivity = true;
      session.addMessage("assistant", fallback.summary);
      if (getSettings().notifyOnResponse) sendResponseNotification();
      if (app.hasPendingMessages("steering")) app.flushPendingMessages("steering");
      completion = "success";
      streamedText = fallback.summary;
      rawToolPayloadText = null;
    }
  }

  if (rawToolPayloadText) {
    session.addMessage("assistant", "[raw tool payload hidden]");
    app.addMessage("system", "Model emitted raw tool syntax. Hidden from chat.");
    if (getSettings().notifyOnResponse) sendResponseNotification();
    if (app.hasPendingMessages("steering")) app.flushPendingMessages("steering");
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
