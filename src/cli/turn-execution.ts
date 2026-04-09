import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { estimateTextTokens } from "../ai/tokens.js";
import type { ModelHandle } from "../ai/providers.js";
import { rewriteAssistantForCaveman } from "../core/caveman.js";
import { resolveCavemanLevel } from "../core/context.js";
import { getSettings, type Mode } from "../core/config.js";
import { buildSimpleFileTaskPromptBlock, detectSimpleFileTask } from "../core/simple-file-task.js";
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
  normalizeEditCompletionText,
  resolveExecutionTarget,
  shouldEnforceToolFirstTurn,
  shouldRequestThinkTags,
  shouldSuppressPlanningNarration,
  shouldUseToolFirstDisplay,
} from "./turn-runner-support.js";
import type { Session } from "../core/session.js";
import { sendResponseNotification } from "./notify.js";
import type { SpecialistModelRole } from "./model-routing.js";
import { createLiveToolCallbacks } from "./turn-tool-callbacks.js";
import { createStreamTokenTracker } from "./stream-token-tracker.js";
import { executeRawToolPayloadFallback } from "./raw-tool-fallback.js";
import { captureNativeWorkspaceBaseline, recordNativeWorkspaceDelta, shouldExposeOpaqueNativeWorkspaceEdits } from "./native-workspace-observer.js";
import { resolveTurnExecution } from "./turn-execution-setup.js";
import { readFileDirect } from "../tools/file-ops.js";
import { observeToolResult } from "./turn-tool-observer.js";
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
  addToolCall(name: string, preview: string, args?: unknown, callId?: string): void;
  updateToolCallArgs(name: string, preview: string, args?: unknown, callId?: string): void;
  addToolResult(name: string, result: string, error?: boolean, detail?: string, callId?: string): void;
  onAbortRequest(callback: () => void): void;
  hasPendingMessages(delivery?: PendingDelivery): boolean;
  flushPendingMessages(delivery: PendingDelivery): void;
  rollbackLastAssistantMessage(): void;
}

interface ExtensionHooks { emit(event: string, payload: Record<string, unknown>): void; }
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
  let visibleAssistantText = "";
  let heldPreToolText = "";
  let streamedReasoning = "";
  let sawToolActivity = false;
  session.getContextOptimizer().nextTurn();
  const nextToolCalls: string[] = [];

  const settings = getSettings();
  const simpleFileTask = detectSimpleFileTask(text);
  let effectiveTransientUserContext = transientUserContext;
  const hasRequiredSimpleTool = (): boolean => !simpleFileTask
    || simpleFileTask.completeWithRead
    || nextToolCalls.includes(simpleFileTask.requiredTool);

  const appendTransientContext = (block: string): void => {
    effectiveTransientUserContext = [effectiveTransientUserContext, block].filter(Boolean).join("\n\n");
  };
  const exposeSimpleRead = (): { content: string; totalLines?: number; failed?: boolean } | null => {
    if (!simpleFileTask || (!simpleFileTask.preRead && !simpleFileTask.completeWithRead)) return null;
    const args = { path: simpleFileTask.path, mode: "full" as const, refresh: true };
    const callId = `simple-read:${simpleFileTask.path}`;
    nextToolCalls.push("readFile");
    app.addToolCall("readFile", simpleFileTask.path, args, callId);
    const result = readFileDirect(args);
    const detail = observeToolResult({
      session,
      toolName: "readFile",
      result,
      toolArgs: args,
    });
    if (result.success === false) {
      app.addToolResult("readFile", result.error.slice(0, 80), true, detail, callId);
      return { content: "", failed: true };
    }
    app.addToolResult("readFile", "ok", false, detail, callId);
    return { content: result.content, totalLines: result.totalLines };
  };

  const preRead = exposeSimpleRead();
  if (simpleFileTask) {
    appendTransientContext(buildSimpleFileTaskPromptBlock(simpleFileTask));
  }
  if (preRead && !preRead.failed && simpleFileTask) {
    appendTransientContext(`--- @${simpleFileTask.path} (${preRead.totalLines ?? "?"} lines, already read by runtime) ---\n${preRead.content}`);
  }

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
    transientUserContext: effectiveTransientUserContext,
    app,
    resolveSpecialistModel,
  });
  let turnSystemPrompt = initialTurnSystemPrompt;
  let abortController: AbortController | null = new AbortController();
  let steeringInterruptRequested = false;
  const exposedToolCount = canUseSdkTools(executionModel) ? policy.allowedTools.length : 0;
  const effectiveCavemanLevel = resolveCavemanLevel(settings.cavemanLevel ?? "auto", text);
  const minimalOutputPolicy = getMinimalOutputPolicy({ text, policy, modelRuntime: executionModel.runtime });
  const toolFirstDisplay = shouldUseToolFirstDisplay({ text, policy });
  const nativeWorkspaceBaseline = executionModel.runtime === "native-cli" && shouldExposeOpaqueNativeWorkspaceEdits(policy) ? captureNativeWorkspaceBaseline(process.cwd()) : null;

  const exposeOpaqueNativeEdits = (): void => {
    if (!nativeWorkspaceBaseline || sawToolActivity) return;
    const touched = recordNativeWorkspaceDelta(session, nativeWorkspaceBaseline);
    for (const path of touched) {
      const callId = `native-observed-edit:${path}`;
      nextToolCalls.push("workspaceEdit");
      app.addToolCall("workspaceEdit", path, { path }, callId);
      app.addToolResult("workspaceEdit", "ok", false, "observed on disk", callId);
    }
    if (touched.length > 0) sawToolActivity = true;
  };

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
      const actionTextMayStream = simpleFileTask ? hasRequiredSimpleTool() : sawToolActivity;
      if (looksLikeRawToolPayload(nextText)) {
        streamedText = nextText;
        if (toolFirstDisplay && !actionTextMayStream) heldPreToolText += delta;
        return;
      }
      if (!actionTextMayStream && shouldSuppressPlanningNarration(nextText, policy, executionModel.runtime)) {
        streamedText = nextText;
        if (toolFirstDisplay) heldPreToolText += delta;
        return;
      }
      if (toolFirstDisplay && !actionTextMayStream) {
        streamedText = nextText;
        heldPreToolText += delta;
        return;
      }
      app.appendToLastMessage(delta);
      streamedText = nextText;
      visibleAssistantText += delta;
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
      exposeOpaqueNativeEdits();
      const rawContent = streamedText.trim();
      let content = (visibleAssistantText.trim() || rawContent);
      const rawPayload = looksLikeRawToolPayload(rawContent) ? rawContent : null;
      if (!rawPayload) content = normalizeEditCompletionText(content, policy);
      const missingSimpleRequiredTool = !hasRequiredSimpleTool();
      if (
        toolFirstDisplay
        && !visibleAssistantText.trim()
        && (sawToolActivity || nextToolCalls.length > 0)
        && !missingSimpleRequiredTool
      ) {
        const heldRaw = heldPreToolText.trim();
        const held = normalizeEditCompletionText(heldRaw, policy);
        content = held && !shouldSuppressPlanningNarration(heldRaw, policy, executionModel.runtime)
          ? held
          : "Done.";
        app.appendToLastMessage(content);
        visibleAssistantText = content;
      }
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
      if (rawPayload) {
        if (visibleAssistantText.trim()) app.rollbackLastAssistantMessage();
        rawToolPayloadText = rawPayload;
        completion = "empty";
        return;
      }
      if (
        missingSimpleRequiredTool
      ) {
        if (visibleAssistantText.trim()) app.rollbackLastAssistantMessage();
        completion = "insufficient";
        return;
      }
      if (shouldEnforceToolFirstTurn({
        text,
        assistantText: content,
        toolActivity: sawToolActivity || nextToolCalls.length > 0,
        policy,
        model: executionModel,
      })) {
        if (visibleAssistantText.trim()) app.rollbackLastAssistantMessage();
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
        toolChoice: simpleFileTask && canUseSdkTools(executionModel) && policy.allowedTools.includes(simpleFileTask.requiredTool)
          ? { type: "tool", toolName: simpleFileTask.requiredTool }
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
