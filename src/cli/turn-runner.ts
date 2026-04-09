import type { ModelHandle } from "../ai/providers.js";
import { checkBudget } from "../core/budget.js";
import { getSettings, type Mode } from "../core/config.js";
import { clearTodo } from "../tools/todo.js";
import type { Session } from "../core/session.js";
import type { ToolName } from "../tools/registry.js";
import type { SpecialistModelRole } from "./model-routing.js";
import {
  buildTouchedFilesEvidence,
  executeTurnWithRetries,
  finalizeTurnLifecycle,
  maybeHandleFastPathTurn,
  maybeRepairValidationFailure,
  prepareTurnExecution,
  type ExtensionHooks,
  type TurnRunnerApp,
} from "./turn-runner-flow.js";
export { buildTouchedFilesEvidence } from "./turn-runner-flow.js";

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
  const fastPath = await maybeHandleFastPathTurn({
    app,
    session,
    text,
    images,
    activeModel,
    currentModelId,
    smallModel,
    smallModelId,
    alreadyAddedUserMessage,
  });
  if (fastPath.handled) {
    return { lastToolCalls, lastActivityTime: fastPath.lastActivityTime };
  }
  const { policy, prepared } = await prepareTurnExecution({
    app,
    session,
    text,
    activeModel,
    currentModelId,
    smallModel,
    smallModelId,
    currentMode,
    systemPrompt,
    effectiveImages,
    lastToolCalls,
    lastActivityTime,
    forceRoute,
    transientUserContext: fastPath.transientUserContext,
    resolveSpecialistModel,
  });
  clearTodo();
  const executed = await executeTurnWithRetries({
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
    prepared,
    forceRoute,
    transientUserContext: fastPath.transientUserContext,
    resolveSpecialistModel,
  });
  if (!executed.result.toolActivity && executed.result.completion === "insufficient") {
    app.addMessage("system", "Model answered without using tools. Try a stronger model with /model.");
    return { lastToolCalls: executed.result.nextToolCalls, lastActivityTime: executed.lastActivityTime };
  }

  const repair = maybeRepairValidationFailure({
    app,
    session,
    result: executed.result,
    repairDepth,
  });
  if (repair.shouldRepair) {
    return runModelTurn({
      ...options,
      text: `Fix the validation failures from the last edit. Here is the validation output:\n\n${repair.report}`,
      images: undefined,
      lastToolCalls: executed.result.nextToolCalls,
      lastActivityTime: executed.lastActivityTime,
      alreadyAddedUserMessage: false,
      repairDepth: repairDepth + 1,
      resolveSpecialistModel,
    });
  }

  finalizeTurnLifecycle({
    app,
    session,
    text,
    result: executed.result,
    activeModel,
    currentModelId,
    smallModel,
    smallModelId,
  });
  return {
    lastToolCalls: executed.result.nextToolCalls,
    lastActivityTime: executed.result.steeringInterrupted ? Date.now() : executed.lastActivityTime,
  };
}
