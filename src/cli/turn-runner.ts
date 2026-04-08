import type { ModelHandle } from "../ai/providers.js";
import { checkBudget } from "../core/budget.js";
import { getSettings, type Mode } from "../core/config.js";
import { resolveTurnPolicy } from "../core/turn-policy.js";
import { clearTodo } from "../tools/todo.js";
import { isDefaultSessionName, type Session } from "../core/session.js";
import { runValidationSuite } from "./auto-validate.js";
import type { ToolName } from "../tools/registry.js";
import { executeTurn } from "./turn-execution.js";
import { maybeAutoNameSession } from "./chat-naming.js";
import { tryRepoTaskFastPath } from "./repo-fastpath.js";
import type { SpecialistModelRole } from "./model-routing.js";
import {
  addUserTurnToSession,
  maybeAutoCompactTurnContext,
  maybeRefreshIdleContext,
  prepareTurnContext,
  selectMessagesForTurn,
  shouldRetryOnMainModel,
  shouldRetryWithToolRequirement,
} from "./turn-runner-stages.js";
import {
  captureNativeWorkspaceBaseline,
  recordNativeWorkspaceDelta,
  type NativeWorkspaceBaseline,
} from "./native-workspace-observer.js";

type PendingDelivery = "steering" | "followup";

interface TurnRunnerApp {
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

function deriveStreamingActivitySummary(text: string, archetype: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const fileMatch = normalized.match(/\b[A-Za-z0-9_./-]+\.[A-Za-z0-9]+\b/);
  const target = fileMatch?.[0];
  switch (archetype) {
    case "edit":
    case "bugfix":
      return target ? `planning changes to ${target}` : "planning the code changes";
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
      return "working through the request";
  }
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
  let nextActivityTime = Date.now();
  const { transientUserContext } = addUserTurnToSession({ app, session, text, effectiveImages, alreadyAddedUserMessage });
  const fastPath = await tryRepoTaskFastPath({ root: process.cwd(), prompt: text, session });
  if (fastPath) {
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
    return { lastToolCalls, lastActivityTime: nextActivityTime };
  }
  const repoState = typeof (session as Session & { getRepoState?: () => ReturnType<Session["getRepoState"]> }).getRepoState === "function"
    ? (session as Session & { getRepoState: () => ReturnType<Session["getRepoState"]> }).getRepoState()
    : undefined;
  const policy = await resolveTurnPolicy(text, lastToolCalls, repoState, activeModel.runtime === "sdk" && activeModel.model
    ? { model: activeModel.model, modelId: currentModelId, providerId: activeModel.provider.id }
    : null);
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

  app.setStreamingActivitySummary?.(deriveStreamingActivitySummary(text, policy.archetype));
  app.setStreaming(true);
  clearTodo();
  const runObservedTurn = async (turnOptions: Parameters<typeof executeTurn>[0]) => {
    const baseline: NativeWorkspaceBaseline | null = activeModel.runtime === "native-cli"
      ? captureNativeWorkspaceBaseline(process.cwd())
      : null;
    const outcome = await executeTurn(turnOptions);
    if (activeModel.runtime === "native-cli" && outcome.completion === "success") {
      recordNativeWorkspaceDelta(session, baseline);
    }
    return outcome;
  };

  let result = await runObservedTurn({
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
  nextActivityTime = result.lastActivityTime;

  if (shouldRetryWithToolRequirement(result, forceRoute)) {
    app.setStatus("model answered without acting - retrying with tool requirement");
    result = await runObservedTurn({
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
    if (!result.toolActivity && result.completion === "insufficient") {
      app.addMessage("system", "Model answered without using tools. Try a stronger model with /model.");
      return { lastToolCalls: result.nextToolCalls, lastActivityTime: nextActivityTime };
    }
  }

  if (shouldRetryOnMainModel(result, forceRoute)) {
    app.setStatus(result.completion === "error"
      ? `small model failed - retrying main`
      : "small model empty - retrying main");
    result = await runObservedTurn({
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

  if (result.steeringInterrupted) {
    app.setThinkingRequested(false);
    app.setStreaming(false);
    app.flushPendingMessages("steering");
    return { lastToolCalls: result.nextToolCalls, lastActivityTime: Date.now() };
  }

  const validation = runValidationSuite(result.nextToolCalls.some((name) => name === "writeFile" || name === "editFile"));
  if (validation.attempted) {
    session.recordVerification("validation", validation.failed ? "fail" : "pass", validation.report);
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
