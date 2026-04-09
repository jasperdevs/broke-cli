import type { ModelHandle } from "../ai/providers.js";
import { getTotalContextTokens } from "../core/compact.js";
import { getSettings, type Mode } from "../core/config.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import type { Session } from "../core/session.js";
import type { TurnPolicy } from "../core/turn-policy.js";
import type { ToolName } from "../tools/registry.js";
import type { SpecialistModelRole } from "./model-routing.js";
import { applyTurnFrame } from "./turn-frame.js";
import { injectTransientUserContext } from "./turn-runner-stages.js";
import { resolveExecutionTarget } from "./turn-runner-support.js";

interface ContextUsageApp {
  setContextUsage(tokens: number, limit: number): void;
}

export function resolveTurnExecution(options: {
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
  app: ContextUsageApp;
  resolveSpecialistModel?: (role: SpecialistModelRole) => { model: ModelHandle; modelId: string } | null;
}): {
  turnSystemPrompt: string;
  optimizedMessages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
  resolvedRoute: "main" | "small";
  executionModel: ModelHandle;
  executionModelId: string;
  thinkingRequested: boolean;
} {
  let turnSystemPrompt = options.activeSystemPrompt;
  const { resolvedRoute, executionModel, executionModelId, thinkingRequested } = resolveExecutionTarget({
    text: options.text,
    policy: options.policy,
    currentMode: options.currentMode,
    sessionMessageCount: options.session.getChatMessages().length,
    lastToolCalls: options.lastToolCalls,
    forceRoute: options.forceRoute,
    activeModel: options.activeModel,
    currentModelId: options.currentModelId,
    smallModel: options.smallModel,
    smallModelId: options.smallModelId,
    effectiveImages: options.effectiveImages,
    resolveSpecialistModel: options.resolveSpecialistModel,
  });
  if (executionModel.provider.id !== options.activeModel.provider.id || executionModelId !== options.currentModelId) {
    turnSystemPrompt = buildSystemPrompt(
      process.cwd(),
      executionModel.provider.id,
      options.currentMode,
      resolveCavemanLevel(getSettings().cavemanLevel ?? "auto", options.text),
      options.policy.promptProfile,
    );
  }
  const optimizedMessages = applyTurnFrame(
    injectTransientUserContext(options.optimizeMessages(options.session.getChatMessages()), options.transientUserContext),
    options.text,
    `${options.policy.archetype}: ${options.policy.scaffold}`,
    options.policy.allowedTools as readonly ToolName[],
  );
  const ctxTokens = getTotalContextTokens(optimizedMessages, turnSystemPrompt, executionModelId);
  options.app.setContextUsage(ctxTokens, options.contextLimit);
  return {
    turnSystemPrompt,
    optimizedMessages,
    resolvedRoute,
    executionModel,
    executionModelId,
    thinkingRequested,
  };
}
