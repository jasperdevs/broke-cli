import { getContextLimit } from "../ai/cost.js";
import type { ModelHandle } from "../ai/providers.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { compactMessages, getTotalContextTokens, splitCompactedMessages } from "../core/compact.js";
import { checkBudget } from "../core/budget.js";
import { getModelContextLimitOverride, getSettings, type Mode } from "../core/config.js";
import { resolveTurnPolicy } from "../core/turn-policy.js";
import { clearTodo } from "../tools/todo.js";
import { isDefaultSessionName, type Session } from "../core/session.js";
import { runValidationSuite } from "./auto-validate.js";
import type { ToolName } from "../tools/registry.js";
import { executeTurn } from "./turn-execution.js";
import { maybeAutoNameSession } from "./chat-naming.js";
import {
  canUseSdkTools,
  resolveExecutionTarget,
} from "./turn-runner-support.js";
import type { SpecialistModelRole } from "./model-routing.js";

async function compactForModel(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: ModelHandle,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (model.runtime === "sdk" && model.model) {
    return compactMessages(messages, model.model, { tailKeep: 5 });
  }
  return messages.slice(-6);
}

type PendingDelivery = "steering" | "followup";

interface TurnRunnerApp {
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
  setCompacting(compacting: boolean, tokenCount?: number): void;
  setStatus(message: string): void;
  addToolCall(name: string, preview: string): void;
  updateToolCallArgs(name: string, preview: string, args?: unknown): void;
  addToolResult(name: string, result: string, error?: boolean, detail?: string): void;
  onAbortRequest(callback: () => void): void;
  hasPendingMessages(delivery?: PendingDelivery): boolean;
  flushPendingMessages(delivery: PendingDelivery): void;
  rollbackLastAssistantMessage(): void;
  getFileContexts?: () => Map<string, string>;
  setSessionName?(name: string): void;
}

interface ExtensionHooks {
  emit(event: string, payload: Record<string, unknown>): void;
}

function selectMessagesForTurn(
  messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>,
  policy: { promptProfile: "full" | "casual"; historyWindow: number | null },
  optimizeMessages: (messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>) => Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>,
): Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }> {
  const baseMessages = policy.promptProfile === "casual" ? messages : optimizeMessages(messages);
  if (policy.historyWindow && baseMessages.length > policy.historyWindow) {
    return baseMessages.slice(-policy.historyWindow);
  }
  return baseMessages;
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
  forceRoute?: "main" | "small";
  resolveSpecialistModel?: (role: SpecialistModelRole) => { model: ModelHandle; modelId: string } | null;
}): Promise<{ lastToolCalls: string[]; lastActivityTime: number }> {
  const { app, session, text, images, activeModel, currentModelId, smallModel, smallModelId, currentMode, systemPrompt, buildTools, hooks, lastToolCalls, lastActivityTime, alreadyAddedUserMessage, repairDepth = 0, forceRoute, resolveSpecialistModel } = options;
  const getContextOptimizer = (): ReturnType<Session["getContextOptimizer"]> => session.getContextOptimizer();
  const settings = getSettings();
  const effectiveImages = settings.images.blockImages ? undefined : images;
  const budget = checkBudget(session.getTotalCost());
  if (!budget.allowed) {
    app.addMessage("system", budget.warning!);
    return { lastToolCalls, lastActivityTime: Date.now() };
  }
  if (budget.warning) app.setStatus(budget.warning);
  const policy = await resolveTurnPolicy(text, lastToolCalls, activeModel.runtime === "sdk" && activeModel.model
    ? { model: activeModel.model, modelId: currentModelId, providerId: activeModel.provider.id }
    : null);
  if (policy.plannerUsage) {
    session.addUsage(policy.plannerUsage.inputTokens, policy.plannerUsage.outputTokens, policy.plannerUsage.cost);
    app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
  }

  const idleMs = Date.now() - lastActivityTime;
  const idleChatMessages = session.getChatMessages();
  if (idleMs > 5 * 60 * 1000 && idleChatMessages.length > 4) {
    const idleMins = Math.floor(idleMs / 60000);
    session.recordIdleCacheCliff();
    app.setStatus(`idle ${idleMins}m - context cache likely expired, consider /compact`);
    if (settings.autoCompact && idleChatMessages.length > 8) {
      try {
        const idleContextTokens = getTotalContextTokens(idleChatMessages, systemPrompt, currentModelId);
        const carryForward = await compactForModel(idleChatMessages, activeModel);
        const parsed = splitCompactedMessages(carryForward);
        if (parsed.summary) session.applyCompaction(parsed.summary, parsed.messages, idleContextTokens);
        else session.replaceConversation(parsed.messages);
        session.recordCompaction({ freshThreadCarryForward: true });
        app.setStatus(`Refreshed hidden context after ${idleMins}m idle to avoid cache waste.`);
      } catch {
        // keep current transcript if carry-forward compaction fails
      }
    }
  }
  let nextActivityTime = Date.now();

  if (!alreadyAddedUserMessage) {
    let fullText = text;
    const fileContexts = app.getFileContexts?.();
    if (fileContexts && fileContexts.size > 0) {
      const contextBlock = [...fileContexts.entries()]
        .map(([path, content]) => `--- @${path} ---\n${content}`)
        .join("\n\n");
      fullText = `${text}\n\n${contextBlock}`;
    }
    app.addMessage("user", text, effectiveImages);
    session.addMessage("user", fullText, effectiveImages);
  }

  const effectiveCavemanLevel = resolveCavemanLevel(getSettings().cavemanLevel ?? "auto", text);
  const previewTarget = resolveExecutionTarget({
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
  const contextLimit = getModelContextLimitOverride(previewTarget.executionModel.provider.id, previewTarget.executionModelId)
    ?? getContextLimit(previewTarget.executionModelId, previewTarget.executionModel.provider.id)
    ?? 128000;
  let turnSystemPrompt = buildSystemPrompt(
    process.cwd(),
    previewTarget.executionModel.provider.id,
    currentMode,
    effectiveCavemanLevel,
    policy.promptProfile,
  );
  turnSystemPrompt += `\n\nExecution scaffold (${policy.archetype}): ${policy.scaffold}`;
  let chatMsgs = session.getChatMessages();
  let selectedMessages = selectMessagesForTurn(chatMsgs, policy, (messages) => getContextOptimizer().optimizeMessages(messages));
  let ctxTokens = getTotalContextTokens(selectedMessages, turnSystemPrompt, currentModelId);
  let ctxPct = contextLimit > 0 ? Math.min(100, Math.round((ctxTokens / contextLimit) * 100)) : 0;
  app.setContextUsage(ctxTokens, contextLimit);

  if (settings.autoCompact && policy.promptProfile !== "casual" && ctxPct > 80 && chatMsgs.length > 8) {
    try {
      app.setCompacting(true, ctxTokens);
      const compacted = await compactForModel(chatMsgs, activeModel);
      const parsed = splitCompactedMessages(compacted);
      if (parsed.summary) session.applyCompaction(parsed.summary, parsed.messages, ctxTokens);
      else session.replaceConversation(parsed.messages);
      session.recordCompaction();
      app.setCompacting(false);
      app.setStatus(`Auto-compacted older context. Kept ${session.getMessages().length} visible messages.`);
      chatMsgs = session.getChatMessages();
      selectedMessages = selectMessagesForTurn(chatMsgs, policy, (messages) => getContextOptimizer().optimizeMessages(messages));
      ctxTokens = getTotalContextTokens(selectedMessages, turnSystemPrompt, currentModelId);
      ctxPct = contextLimit > 0 ? Math.min(100, Math.round((ctxTokens / contextLimit) * 100)) : 0;
      app.setContextUsage(ctxTokens, contextLimit);
    } catch {
      app.setCompacting(false);
    }
  }

  app.setStreaming(true);
  clearTodo();
  let result = await executeTurn({
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
    activeSystemPrompt: turnSystemPrompt,
    optimizeMessages: (messages) => selectMessagesForTurn(messages, policy, (msgs) => getContextOptimizer().optimizeMessages(msgs)),
    forceRoute,
    resolveSpecialistModel,
  });
  nextActivityTime = result.lastActivityTime;

  if (!forceRoute && !result.toolActivity && result.completion === "insufficient") {
    app.setStatus("model answered without acting - retrying with tool requirement");
    result = await executeTurn({
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
      activeSystemPrompt: `${turnSystemPrompt}\n\nIMPORTANT: This request requires real repo actions. Use the available tools to inspect or modify files before any completion text. Do not claim a file was added, changed, fixed, committed, or pushed unless a tool in this turn actually did it.`,
      optimizeMessages: (messages) => selectMessagesForTurn(messages, policy, (msgs) => getContextOptimizer().optimizeMessages(msgs)),
      forceRoute: "main",
      resolveSpecialistModel,
    });
    nextActivityTime = result.lastActivityTime;
    if (!result.toolActivity && result.completion === "insufficient") {
      app.addMessage("system", "Model answered without using tools. Try a stronger model with /model.");
      return { lastToolCalls: result.nextToolCalls, lastActivityTime: nextActivityTime };
    }
  }

  if (result.resolvedRoute === "small" && !forceRoute && !result.toolActivity && (result.completion === "empty" || result.completion === "error")) {
    app.setStatus(result.completion === "error"
      ? `small model failed - retrying main`
      : "small model empty - retrying main");
    result = await executeTurn({
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
      activeSystemPrompt: turnSystemPrompt,
      optimizeMessages: (messages) => selectMessagesForTurn(messages, policy, (msgs) => getContextOptimizer().optimizeMessages(msgs)),
      forceRoute: "main",
    });
    nextActivityTime = result.lastActivityTime;
  }

  if (result.steeringInterrupted) {
    app.setThinkingRequested(false);
    app.setStreaming(false);
    app.flushPendingMessages("steering");
    return { lastToolCalls: result.nextToolCalls, lastActivityTime: Date.now() };
  }

  const validation = runValidationSuite(result.nextToolCalls.some((name) => name === "writeFile" || name === "editFile"));
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
        lastToolCalls: result.nextToolCalls,
        lastActivityTime: nextActivityTime,
        alreadyAddedUserMessage: false,
        repairDepth: repairDepth + 1,
        resolveSpecialistModel,
      });
    }
  }

  if (app.hasPendingMessages("followup")) app.flushPendingMessages("followup");

  if (typeof (session as any).getName !== "function" || isDefaultSessionName(session.getName())) {
    const assistantText = result.assistantText.trim();
    if (assistantText) {
      void maybeAutoNameSession({
        app,
        session,
        userText: text,
        assistantText,
        smallModel,
        smallModelId,
        activeModel,
        currentModelId,
      });
    }
  }

  return { lastToolCalls: result.nextToolCalls, lastActivityTime: nextActivityTime };
}
