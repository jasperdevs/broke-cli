import { getContextLimit } from "../ai/cost.js";
import type { ModelHandle } from "../ai/providers.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { COMPACTION_SUMMARY_PREFIX, compactMessages, getTotalContextTokens, splitCompactedMessages } from "../core/compact.js";
import { getModelContextLimitOverride, getSettings, type Mode } from "../core/config.js";
import type { TurnPolicy } from "../core/turn-policy.js";
import type { Session } from "../core/session.js";
import { resolveExecutionTarget } from "./turn-runner-support.js";
import type { SpecialistModelRole } from "./model-routing.js";
import { applyTurnFrame } from "./turn-frame.js";
import { estimateTextTokens } from "../ai/tokens.js";

export type TurnChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: Array<{ mimeType: string; data: string }>;
};

export interface TurnRunnerStageApp {
  addMessage(role: "user" | "assistant" | "system", content: string, images?: Array<{ mimeType: string; data: string }>): void;
  setStatus(message: string): void;
  setCompacting(compacting: boolean, tokenCount?: number): void;
  setContextUsage(tokens: number, limit: number): void;
  getFileContexts?(): Map<string, string>;
}

export interface PreparedTurnContext {
  contextLimit: number;
  turnSystemPrompt: string;
  selectedMessages: TurnChatMessage[];
  contextTokens: number;
  contextPct: number;
}

export interface TurnExecutionResultLike {
  completion: "success" | "empty" | "error" | "insufficient";
  resolvedRoute: "main" | "small";
  toolActivity: boolean;
}

export async function compactForModel(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: ModelHandle,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (model.runtime === "sdk" && model.model) {
    return compactMessages(messages, model.model, { tailKeep: 5 });
  }
  return messages.slice(-6);
}

export function selectMessagesForTurn(
  messages: TurnChatMessage[],
  policy: { promptProfile: "full" | "casual"; historyWindow: number | null },
  optimizeMessages: (messages: TurnChatMessage[]) => TurnChatMessage[],
  budget?: { maxTokens: number; modelId?: string },
): TurnChatMessage[] {
  const baseMessages = policy.promptProfile === "casual" ? messages : optimizeMessages(messages);
  const windowed = policy.historyWindow && baseMessages.length > policy.historyWindow
    ? baseMessages.slice(-policy.historyWindow)
    : baseMessages;
  if (!budget || budget.maxTokens <= 0) return windowed;

  const summary = windowed[0]?.role === "user" && windowed[0].content.startsWith(COMPACTION_SUMMARY_PREFIX)
    ? windowed[0]
    : null;
  const tail = summary ? windowed.slice(1) : windowed;
  const selected: TurnChatMessage[] = [];
  let tokenCount = summary ? estimateTextTokens(summary.content, budget.modelId) : 0;
  for (let i = tail.length - 1; i >= 0; i--) {
    const message = tail[i]!;
    const nextCost = estimateTextTokens(message.content, budget.modelId);
    if (selected.length > 0 && tokenCount + nextCost > budget.maxTokens) break;
    selected.unshift(message);
    tokenCount += nextCost;
  }
  return summary ? [summary, ...selected] : selected;
}

export async function maybeRefreshIdleContext(options: {
  app: TurnRunnerStageApp;
  session: Session;
  systemPrompt: string;
  currentModelId: string;
  activeModel: ModelHandle;
  lastActivityTime: number;
}): Promise<void> {
  const { app, session, systemPrompt, currentModelId, activeModel, lastActivityTime } = options;
  const settings = getSettings();
  const idleMs = Date.now() - lastActivityTime;
  const idleChatMessages = session.getChatMessages();
  if (idleMs <= 5 * 60 * 1000 || idleChatMessages.length <= 4) return;
  const idleMins = Math.floor(idleMs / 60000);
  session.recordIdleCacheCliff();
  app.setStatus(`idle ${idleMins}m - context cache likely expired, consider /compact`);
  if (!settings.autoCompact || idleChatMessages.length <= 8) return;
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

export function addUserTurnToSession(options: {
  app: Pick<TurnRunnerStageApp, "addMessage" | "getFileContexts">;
  session: Session;
  text: string;
  effectiveImages?: Array<{ mimeType: string; data: string }>;
  alreadyAddedUserMessage?: boolean;
}): void {
  const { app, session, text, effectiveImages, alreadyAddedUserMessage } = options;
  if (alreadyAddedUserMessage) return;
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

export function prepareTurnContext(options: {
  app: Pick<TurnRunnerStageApp, "setContextUsage">;
  session: Session;
  text: string;
  activeModel: ModelHandle;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  currentMode: Mode;
  policy: TurnPolicy;
  effectiveImages?: Array<{ mimeType: string; data: string }>;
  lastToolCalls: string[];
  forceRoute?: "main" | "small";
  resolveSpecialistModel?: (role: SpecialistModelRole) => { model: ModelHandle; modelId: string } | null;
  optimizeMessages: (messages: TurnChatMessage[]) => TurnChatMessage[];
}): PreparedTurnContext {
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
    lastToolCalls,
    forceRoute,
    resolveSpecialistModel,
    optimizeMessages,
  } = options;
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
  const contextBudget = Math.max(
    4000,
    Math.min(
      getSettings().compaction.keepRecentTokens,
      Math.max(4000, Math.floor(contextLimit * 0.4)),
    ),
  );
  let turnSystemPrompt = buildSystemPrompt(
    process.cwd(),
    previewTarget.executionModel.provider.id,
    currentMode,
    effectiveCavemanLevel,
    policy.promptProfile,
  );
  const selectedMessages = applyTurnFrame(
    selectMessagesForTurn(session.getChatMessages(), policy, optimizeMessages, {
      maxTokens: contextBudget,
      modelId: previewTarget.executionModelId,
    }),
    text,
    `Execution scaffold (${policy.archetype}): ${policy.scaffold}`,
    policy.allowedTools,
  );
  const contextTokens = getTotalContextTokens(selectedMessages, turnSystemPrompt, currentModelId);
  const contextPct = contextLimit > 0 ? Math.min(100, Math.round((contextTokens / contextLimit) * 100)) : 0;
  app.setContextUsage(contextTokens, contextLimit);
  return { contextLimit, turnSystemPrompt, selectedMessages, contextTokens, contextPct };
}

export async function maybeAutoCompactTurnContext(options: {
  app: TurnRunnerStageApp;
  session: Session;
  activeModel: ModelHandle;
  currentModelId: string;
  policy: TurnPolicy;
  prepared: PreparedTurnContext;
  optimizeMessages: (messages: TurnChatMessage[]) => TurnChatMessage[];
}): Promise<PreparedTurnContext> {
  const { app, session, activeModel, currentModelId, policy, prepared, optimizeMessages } = options;
  const settings = getSettings();
  let nextPrepared = prepared;
  const chatMsgs = session.getChatMessages();
  if (!settings.autoCompact || policy.promptProfile === "casual" || prepared.contextPct <= 80 || chatMsgs.length <= 8) {
    return nextPrepared;
  }
  try {
    app.setCompacting(true, prepared.contextTokens);
    const compacted = await compactForModel(chatMsgs, activeModel);
    const parsed = splitCompactedMessages(compacted);
    if (parsed.summary) session.applyCompaction(parsed.summary, parsed.messages, prepared.contextTokens);
    else session.replaceConversation(parsed.messages);
    session.recordCompaction();
    app.setCompacting(false);
    app.setStatus(`Auto-compacted older context. Kept ${session.getMessages().length} visible messages.`);
    const selectedMessages = applyTurnFrame(
      selectMessagesForTurn(session.getChatMessages(), policy, optimizeMessages, {
        maxTokens: Math.max(
          4000,
          Math.min(
            getSettings().compaction.keepRecentTokens,
            Math.max(4000, Math.floor(prepared.contextLimit * 0.4)),
          ),
        ),
        modelId: currentModelId,
      }),
      "",
      `Execution scaffold (${policy.archetype}): ${policy.scaffold}`,
      policy.allowedTools,
    );
    const contextTokens = getTotalContextTokens(selectedMessages, prepared.turnSystemPrompt, currentModelId);
    const contextPct = prepared.contextLimit > 0 ? Math.min(100, Math.round((contextTokens / prepared.contextLimit) * 100)) : 0;
    app.setContextUsage(contextTokens, prepared.contextLimit);
    nextPrepared = { ...prepared, selectedMessages, contextTokens, contextPct };
  } catch {
    app.setCompacting(false);
  }
  return nextPrepared;
}

export function shouldRetryWithToolRequirement(
  result: TurnExecutionResultLike,
  forceRoute?: "main" | "small",
): boolean {
  return !forceRoute && !result.toolActivity && result.completion === "insufficient";
}

export function shouldRetryOnMainModel(
  result: TurnExecutionResultLike,
  forceRoute?: "main" | "small",
): boolean {
  return result.resolvedRoute === "small"
    && !forceRoute
    && !result.toolActivity
    && (result.completion === "empty" || result.completion === "error");
}
