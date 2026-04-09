import type { ModelHandle } from "../ai/providers.js";
import { isDefaultSessionName, type Session } from "../core/session.js";
import { getSettings, type Mode } from "../core/config.js";
import { applySimpleFileTaskPolicy, detectSimpleFileTask } from "../core/simple-file-task.js";
import { resolveTurnPolicy } from "../core/turn-policy.js";
import type { ToolName } from "../tools/registry.js";
import { executeTurn } from "./turn-execution.js";
import { maybeAutoNameSession } from "./chat-naming.js";
import { tryRepoTaskFastPath } from "./repo-fastpath.js";
import { readFileDirect } from "../tools/file-ops.js";
import { observeToolResult } from "./turn-tool-observer.js";
import type { SpecialistModelRole } from "./model-routing.js";
import {
  addUserTurnToSession,
  maybeAutoCompactTurnContext,
  maybeRefreshIdleContext,
  prepareTurnContext,
  selectMessagesForTurn,
  shouldRetryOnMainModel,
  shouldRetryWithToolRequirement,
  type PreparedTurnContext,
} from "./turn-runner-stages.js";
import { runValidationSuite } from "./auto-validate.js";

type PendingDelivery = "steering" | "followup";

export interface TurnRunnerApp {
  addMessage(role: "user" | "assistant" | "system", content: string, images?: Array<{ mimeType: string; data: string }>): void;
  appendToLastMessage(delta: string): void;
  replaceLastAssistantMessage?(content: string): void;
  appendThinking(delta: string): void;
  setThinkingRequested(requested: boolean): void;
  setStreamingActivitySummary?(summary: string): void;
  getLastAssistantContent(): string;
  setStreaming(streaming: boolean): void;
  setStreamTokens(tokens: number): void;
  updateUsage(cost: number, inputTokens: number, outputTokens: number): void;
  setContextUsage(tokens: number, limit: number): void;
  setCompacting(compacting: boolean, tokenCount?: number): void;
  setStatus(message: string): void;
  addToolCall(name: string, preview: string, args?: unknown, callId?: string): void;
  updateToolCallArgs(name: string, preview: string, args?: unknown, callId?: string): void;
  addToolResult(name: string, result: string, error?: boolean, detail?: string, callId?: string): void;
  onAbortRequest(callback: () => void): void;
  hasPendingMessages(delivery?: PendingDelivery): boolean;
  flushPendingMessages(delivery: PendingDelivery): void;
  rollbackLastAssistantMessage(): void;
  getFileContexts?: () => Map<string, string>;
  setSessionName?(name: string): void;
}

export interface ExtensionHooks {
  emit(event: string, payload: Record<string, unknown>): void;
}

function deriveStreamingActivitySummary(text: string, archetype: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const fileMatch = normalized.match(/\b[A-Za-z0-9_./-]+\.[A-Za-z0-9]+\b/);
  const target = fileMatch?.[0];
  switch (archetype) {
    case "edit":
    case "bugfix":
      return target ? `preparing action for ${target}` : "preparing the first action";
    case "explore":
      return target ? `checking ${target}` : "scanning the repo";
    case "shell":
      return "preparing the command result";
    case "review":
      return "reviewing the code";
    case "planning":
      return "working through the plan";
    case "research":
      return "gathering the answer";
    default:
      return "";
  }
}

export function buildTouchedFilesEvidence(touched: string[]): string | null {
  const files = touched.filter(Boolean).slice(0, 4);
  if (files.length === 0) return null;
  const suffix = touched.length > files.length ? ` (+${touched.length - files.length} more)` : "";
  return `Changed files: ${files.join(", ")}${suffix}`;
}

export async function maybeHandleFastPathTurn(options: {
  app: TurnRunnerApp;
  session: Session;
  text: string;
  images?: Array<{ mimeType: string; data: string }>;
  activeModel: ModelHandle;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  alreadyAddedUserMessage?: boolean;
}): Promise<{ handled: boolean; transientUserContext?: string; lastActivityTime: number }> {
  const { app, session, text, images, activeModel, currentModelId, smallModel, smallModelId, alreadyAddedUserMessage } = options;
  const settings = getSettings();
  const effectiveImages = settings.images.blockImages ? undefined : images;
  const { transientUserContext } = addUserTurnToSession({ app, session, text, effectiveImages, alreadyAddedUserMessage });
  const fastPath = await tryRepoTaskFastPath({ root: process.cwd(), prompt: text, session });
  if (!fastPath) {
    const simpleTask = detectSimpleFileTask(text);
    if (simpleTask?.completeWithRead) {
      const args = { path: simpleTask.path, mode: "full" as const, refresh: true };
      const callId = `simple-read-only:${simpleTask.path}`;
      app.addToolCall("readFile", simpleTask.path, args, callId);
      const result = readFileDirect(args);
      const detail = observeToolResult({ session, toolName: "readFile", result, toolArgs: args });
      if (result.success === false) {
        app.addToolResult("readFile", result.error.slice(0, 80), true, detail, callId);
        const content = `Blocked: ${result.error}`;
        app.addMessage("assistant", content);
        session.addMessage("assistant", content);
      } else {
        app.addToolResult("readFile", "ok", false, detail, callId);
        const content = `Read ${simpleTask.path}.`;
        app.addMessage("assistant", content);
        session.addMessage("assistant", content);
      }
      session.recordTurn({ toolsExposed: 1, toolsUsed: 1, visibleOutputTokens: 1, hiddenOutputTokens: 0 });
      app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
      return { handled: true, transientUserContext, lastActivityTime: Date.now() };
    }
    return { handled: false, transientUserContext, lastActivityTime: Date.now() };
  }

  app.addMessage("assistant", fastPath.content);
  session.addMessage("assistant", fastPath.content);
  session.recordTurn({
    toolsExposed: 0,
    toolsUsed: 0,
    visibleOutputTokens: 0,
    hiddenOutputTokens: 0,
  });
  app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
  if (typeof (session as any).getName !== "function" || isDefaultSessionName(session.getName())) {
    void maybeAutoNameSession({
      app,
      session,
      userText: text,
      assistantText: fastPath.content,
      smallModel,
      smallModelId,
      activeModel,
      currentModelId,
    });
  }
  return { handled: true, transientUserContext, lastActivityTime: Date.now() };
}

export async function prepareTurnExecution(options: {
  app: TurnRunnerApp;
  session: Session;
  text: string;
  activeModel: ModelHandle;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  currentMode: Mode;
  systemPrompt: string;
  effectiveImages?: Array<{ mimeType: string; data: string }>;
  lastToolCalls: string[];
  lastActivityTime: number;
  forceRoute?: "main" | "small";
  transientUserContext?: string;
  resolveSpecialistModel?: (role: SpecialistModelRole) => { model: ModelHandle; modelId: string } | null;
}): Promise<{ policy: Awaited<ReturnType<typeof resolveTurnPolicy>>; prepared: PreparedTurnContext }> {
  const { app, session, text, activeModel, currentModelId, smallModel, smallModelId, currentMode, systemPrompt, effectiveImages, lastToolCalls, lastActivityTime, forceRoute, transientUserContext, resolveSpecialistModel } = options;
  const getContextOptimizer = (): ReturnType<Session["getContextOptimizer"]> => session.getContextOptimizer();
  const repoState = typeof (session as Session & { getRepoState?: () => ReturnType<Session["getRepoState"]> }).getRepoState === "function"
    ? (session as Session & { getRepoState: () => ReturnType<Session["getRepoState"]> }).getRepoState()
    : undefined;
  let policy = await resolveTurnPolicy(text, lastToolCalls, repoState, activeModel.runtime === "sdk" && activeModel.model
    ? { model: activeModel.model, modelId: currentModelId, providerId: activeModel.provider.id }
    : null);
  policy = applySimpleFileTaskPolicy(policy, detectSimpleFileTask(text));
  if (policy.plannerUsage) {
    session.addUsage(policy.plannerUsage.inputTokens, policy.plannerUsage.outputTokens, policy.plannerUsage.cost);
    app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
  }
  await maybeRefreshIdleContext({ app, session, systemPrompt, currentModelId, activeModel, lastActivityTime });
  let prepared = prepareTurnContext({
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
    optimizeMessages: (messages) => selectMessagesForTurn(messages, policy, (msgs) => getContextOptimizer().optimizeMessages(msgs)),
  });
  prepared = await maybeAutoCompactTurnContext({
    app,
    session,
    activeModel,
    currentModelId,
    policy,
    prepared,
    transientUserContext,
    optimizeMessages: (messages) => selectMessagesForTurn(messages, policy, (msgs) => getContextOptimizer().optimizeMessages(msgs)),
  });
  return { policy, prepared };
}

async function runObservedTurn(
  activeModel: ModelHandle,
  session: Session,
  turnOptions: Parameters<typeof executeTurn>[0],
) {
  void activeModel;
  void session;
  return executeTurn(turnOptions);
}

export async function executeTurnWithRetries(options: {
  app: TurnRunnerApp;
  session: Session;
  text: string;
  activeModel: ModelHandle;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  currentMode: Mode;
  policy: Awaited<ReturnType<typeof resolveTurnPolicy>>;
  effectiveImages?: Array<{ mimeType: string; data: string }>;
  buildTools: (allowedTools: readonly ToolName[]) => Record<string, unknown>;
  hooks: ExtensionHooks;
  lastToolCalls: string[];
  prepared: PreparedTurnContext;
  forceRoute?: "main" | "small";
  transientUserContext?: string;
  resolveSpecialistModel?: (role: SpecialistModelRole) => { model: ModelHandle; modelId: string } | null;
}): Promise<{ result: Awaited<ReturnType<typeof executeTurn>>; lastActivityTime: number }> {
  const { app, session, text, activeModel, currentModelId, smallModel, smallModelId, currentMode, policy, effectiveImages, buildTools, hooks, lastToolCalls, prepared, forceRoute, transientUserContext, resolveSpecialistModel } = options;
  const getContextOptimizer = (): ReturnType<Session["getContextOptimizer"]> => session.getContextOptimizer();
  app.setStreamingActivitySummary?.(deriveStreamingActivitySummary(text, policy.archetype));
  app.setStreaming(true);

  let result = await runObservedTurn(activeModel, session, {
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
    contextLimit: prepared.contextLimit,
    activeSystemPrompt: prepared.turnSystemPrompt,
    optimizeMessages: (messages) => selectMessagesForTurn(messages, policy, (msgs) => getContextOptimizer().optimizeMessages(msgs)),
    forceRoute,
    transientUserContext,
    preparedSpend: prepared.spend,
    resolveSpecialistModel,
  });
  let nextActivityTime = result.lastActivityTime;

  if (shouldRetryWithToolRequirement(result, forceRoute)) {
    app.setStatus("model answered without acting - retrying with tool requirement");
    result = await runObservedTurn(activeModel, session, {
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
      contextLimit: prepared.contextLimit,
      activeSystemPrompt: `${prepared.turnSystemPrompt}\n\nIMPORTANT: This request requires real repo actions. Use the available tools to inspect or modify files before any completion text. Do not claim a file was added, changed, fixed, committed, or pushed unless a tool in this turn actually did it.`,
      optimizeMessages: (messages) => selectMessagesForTurn(messages, policy, (msgs) => getContextOptimizer().optimizeMessages(msgs)),
      forceRoute: "main",
      transientUserContext,
      preparedSpend: prepared.spend,
      resolveSpecialistModel,
    });
    nextActivityTime = result.lastActivityTime;
  }

  if (shouldRetryOnMainModel(result, forceRoute)) {
    app.setStatus(result.completion === "error"
      ? "small model failed - retrying main"
      : "small model empty - retrying main");
    result = await runObservedTurn(activeModel, session, {
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
      contextLimit: prepared.contextLimit,
      activeSystemPrompt: prepared.turnSystemPrompt,
      optimizeMessages: (messages) => selectMessagesForTurn(messages, policy, (msgs) => getContextOptimizer().optimizeMessages(msgs)),
      forceRoute: "main",
      transientUserContext,
      preparedSpend: prepared.spend,
    });
    nextActivityTime = result.lastActivityTime;
  }

  return { result, lastActivityTime: nextActivityTime };
}

export function maybeRepairValidationFailure(options: {
  app: TurnRunnerApp;
  session: Session;
  result: Awaited<ReturnType<typeof executeTurn>>;
  repairDepth: number;
}): { shouldRepair: boolean; report?: string } {
  const { app, session, result, repairDepth } = options;
  const validation = runValidationSuite(result.nextToolCalls.some((name) => name === "writeFile" || name === "editFile"));
  if (!validation.attempted) return { shouldRepair: false };

  session.recordVerification("validation", validation.failed ? "fail" : "pass", validation.report);
  app.addMessage("system", validation.report);
  if (validation.failed && getSettings().autoFixValidation && repairDepth < 1) {
    app.addMessage("system", "Validation failed - attempting one repair pass.");
    return { shouldRepair: true, report: validation.report };
  }
  return { shouldRepair: false };
}

export function finalizeTurnLifecycle(options: {
  app: TurnRunnerApp;
  session: Session;
  text: string;
  result: Awaited<ReturnType<typeof executeTurn>>;
  activeModel: ModelHandle;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
}): void {
  const { app, session, text, result, activeModel, currentModelId, smallModel, smallModelId } = options;
  if (result.steeringInterrupted) {
    app.setThinkingRequested(false);
    app.setStreaming(false);
    app.flushPendingMessages("steering");
    return;
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
}
