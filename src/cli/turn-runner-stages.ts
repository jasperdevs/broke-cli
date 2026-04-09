import { getContextLimit } from "../ai/cost.js";
import type { ModelHandle } from "../ai/providers.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { COMPACTION_SUMMARY_PREFIX, compactMessages, getTotalContextTokens, splitCompactedMessages } from "../core/compact.js";
import { getModelContextLimitOverride, getSettings, type Mode } from "../core/config.js";
import { REPO_STATE_CONTEXT_PREFIX } from "../core/session.js";
import type { TurnPolicy } from "../core/turn-policy.js";
import type { Session } from "../core/session.js";
import { resolveExecutionTarget } from "./turn-runner-support.js";
import type { SpecialistModelRole } from "./model-routing.js";
import { buildNativeFollowupStateContext } from "./native-workspace-observer.js";
import { buildSemanticTaskContext } from "./semantic-task-context.js";
import { applyTurnFrame } from "./turn-frame.js";
import { estimateTextTokens } from "../ai/tokens.js";
import { expandInlineSkillInvocations } from "../core/skills.js";

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
  spend: {
    systemPromptTokens: number;
    replayInputTokens: number;
    stateCarrierTokens: number;
    transientContextTokens: number;
  };
}

export interface TurnExecutionResultLike {
  completion: "success" | "empty" | "error" | "insufficient";
  resolvedRoute: "main" | "small";
  toolActivity: boolean;
}

function buildTransientFileContext(fileContexts?: Map<string, string>): { transcriptNote: string; promptBlock: string } | null {
  if (!fileContexts || fileContexts.size === 0) return null;
  const entries = [...fileContexts.entries()];
  return {
    transcriptNote: `[attached file context available only for this turn] ${entries.map(([path, content]) => `${path} (${content.split("\n").length} lines)`).join(", ")}`,
    promptBlock: entries.map(([path, content]) => `--- @${path} ---\n${content}`).join("\n\n"),
  };
}

function buildFollowupRepoContext(session: Session, text: string): { transcriptNote: string; promptBlock: string } | null {
  const getRepoState = (session as Session & { getRepoState?: () => ReturnType<Session["getRepoState"]> }).getRepoState;
  if (typeof getRepoState !== "function") return null;
  const repoState = getRepoState.call(session);
  if (repoState.recentEdits.length === 0) return null;
  const importOnlyFollowup = /\b(without changing|which files import|what imports|where .* imported)\b/i.test(text);
  if (!/\b(test|tests|coverage|spec|without changing|which files import|what imports|where .* imported)\b/i.test(text)) {
    return null;
  }
  return buildNativeFollowupStateContext(
    session.getCwd(),
    repoState.recentEdits.map((entry) => entry.path),
    importOnlyFollowup ? 3 : 2,
    "summary",
  );
}

export function injectTransientUserContext(messages: TurnChatMessage[], transientUserContext?: string): TurnChatMessage[] {
  if (!transientUserContext?.trim()) return messages;
  const next = messages.map((message) => ({ ...message }));
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]?.role !== "user") continue;
    next[i] = { ...next[i]!, content: `${next[i]!.content}\n\n${transientUserContext}` };
    break;
  }
  return next;
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
  policy: { promptProfile: "full" | "casual" | "lean" | "edit" | "followup"; historyWindow: number | null },
  optimizeMessages: (messages: TurnChatMessage[]) => TurnChatMessage[],
  budget?: { maxTokens: number; modelId?: string },
): TurnChatMessage[] {
  const baseMessages = policy.promptProfile === "casual" ? messages : optimizeMessages(messages);
  const prefixMessages: TurnChatMessage[] = [];
  let prefixIndex = 0;
  while (
    prefixIndex < baseMessages.length
    && baseMessages[prefixIndex]?.role === "user"
    && (
      baseMessages[prefixIndex]!.content.startsWith(COMPACTION_SUMMARY_PREFIX)
      || baseMessages[prefixIndex]!.content.startsWith(REPO_STATE_CONTEXT_PREFIX)
    )
  ) {
    prefixMessages.push(baseMessages[prefixIndex]!);
    prefixIndex += 1;
  }
  const tail = baseMessages.slice(prefixIndex);
  const windowedTail = policy.historyWindow && tail.length > policy.historyWindow
    ? tail.slice(-policy.historyWindow)
    : tail;
  if (!budget || budget.maxTokens <= 0) return [...prefixMessages, ...windowedTail];

  const selected: TurnChatMessage[] = [];
  let tokenCount = prefixMessages.reduce((sum, message) => sum + estimateTextTokens(message.content, budget.modelId), 0);
  for (let i = windowedTail.length - 1; i >= 0; i--) {
    const message = windowedTail[i]!;
    const nextCost = estimateTextTokens(message.content, budget.modelId);
    if (selected.length > 0 && tokenCount + nextCost > budget.maxTokens) break;
    selected.unshift(message);
    tokenCount += nextCost;
  }
  return [...prefixMessages, ...selected];
}

function measurePreparedSpend(messages: TurnChatMessage[], systemPrompt: string, modelId?: string, transientUserContext?: string): PreparedTurnContext["spend"] {
  const systemPromptTokens = estimateTextTokens(systemPrompt, modelId);
  const stateCarrierTokens = messages
    .filter((message) => message.role === "user" && (
      message.content.startsWith(COMPACTION_SUMMARY_PREFIX)
      || message.content.startsWith(REPO_STATE_CONTEXT_PREFIX)
    ))
    .reduce((sum, message) => sum + estimateTextTokens(message.content, modelId), 0);
  const replayInputTokens = messages
    .filter((message) => !(message.role === "user" && (
      message.content.startsWith(COMPACTION_SUMMARY_PREFIX)
      || message.content.startsWith(REPO_STATE_CONTEXT_PREFIX)
    )))
    .slice(0, -1)
    .reduce((sum, message) => sum + estimateTextTokens(message.content, modelId), 0);
  const transientContextTokens = transientUserContext?.trim()
    ? estimateTextTokens(transientUserContext, modelId)
    : 0;
  return {
    systemPromptTokens,
    replayInputTokens,
    stateCarrierTokens,
    transientContextTokens,
  };
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
}): { transientUserContext?: string } {
  const { app, session, text, effectiveImages, alreadyAddedUserMessage } = options;
  if (alreadyAddedUserMessage) return {};
  const fileContext = buildTransientFileContext(app.getFileContexts?.());
  const repoContext = buildFollowupRepoContext(session, text);
  const semanticContext = buildSemanticTaskContext({
    cwd: session.getCwd(),
    userMessage: text,
    repoState: typeof session.getRepoState === "function" ? session.getRepoState() : undefined,
  });
  const skillExpansion = expandInlineSkillInvocations(text);
  const transcriptNotes = [
    skillExpansion.skillName ? `[skill invoked] ${skillExpansion.skillName}` : null,
    fileContext?.transcriptNote,
    repoContext?.transcriptNote,
    semanticContext?.transcriptNote,
  ].filter(Boolean);
  const promptBlocks = [fileContext?.promptBlock, repoContext?.promptBlock, semanticContext?.promptBlock].filter(Boolean);
  const modelText = skillExpansion.expandedText;
  const fullText = transcriptNotes.length > 0 ? `${modelText}\n\n${transcriptNotes.join("\n")}` : modelText;
  app.addMessage("user", text, effectiveImages);
  session.addMessage("user", fullText, effectiveImages);
  return { transientUserContext: promptBlocks.length > 0 ? promptBlocks.join("\n\n") : undefined };
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
  transientUserContext?: string;
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
    transientUserContext,
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
    injectTransientUserContext(selectMessagesForTurn(session.getChatMessages(), policy, optimizeMessages, {
      maxTokens: contextBudget,
      modelId: previewTarget.executionModelId,
    }), transientUserContext),
    text,
    `${policy.archetype}: ${policy.scaffold}`,
    policy.allowedTools,
  );
  const contextTokens = getTotalContextTokens(selectedMessages, turnSystemPrompt, currentModelId);
  const contextPct = contextLimit > 0 ? Math.min(100, Math.round((contextTokens / contextLimit) * 100)) : 0;
  app.setContextUsage(contextTokens, contextLimit);
  return {
    contextLimit,
    turnSystemPrompt,
    selectedMessages,
    contextTokens,
    contextPct,
    spend: measurePreparedSpend(selectedMessages, turnSystemPrompt, previewTarget.executionModelId, transientUserContext),
  };
}

export async function maybeAutoCompactTurnContext(options: {
  app: TurnRunnerStageApp;
  session: Session;
  activeModel: ModelHandle;
  currentModelId: string;
  policy: TurnPolicy;
  prepared: PreparedTurnContext;
  transientUserContext?: string;
  optimizeMessages: (messages: TurnChatMessage[]) => TurnChatMessage[];
}): Promise<PreparedTurnContext> {
  const { app, session, activeModel, currentModelId, policy, prepared, transientUserContext, optimizeMessages } = options;
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
      injectTransientUserContext(selectMessagesForTurn(session.getChatMessages(), policy, optimizeMessages, {
        maxTokens: Math.max(
          4000,
          Math.min(
            getSettings().compaction.keepRecentTokens,
            Math.max(4000, Math.floor(prepared.contextLimit * 0.4)),
          ),
        ),
        modelId: currentModelId,
        }), transientUserContext),
        "",
        `${policy.archetype}: ${policy.scaffold}`,
        policy.allowedTools,
      );
    const contextTokens = getTotalContextTokens(selectedMessages, prepared.turnSystemPrompt, currentModelId);
    const contextPct = prepared.contextLimit > 0 ? Math.min(100, Math.round((contextTokens / prepared.contextLimit) * 100)) : 0;
    app.setContextUsage(contextTokens, prepared.contextLimit);
    nextPrepared = {
      ...prepared,
      selectedMessages,
      contextTokens,
      contextPct,
      spend: measurePreparedSpend(selectedMessages, prepared.turnSystemPrompt, currentModelId, transientUserContext),
    };
  } catch {
    app.setCompacting(false);
  }
  return nextPrepared;
}

export function shouldRetryWithToolRequirement(
  result: TurnExecutionResultLike,
  forceRoute?: "main" | "small",
): boolean {
  return !forceRoute && result.completion === "insufficient";
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
