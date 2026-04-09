import { modelSupportsReasoning } from "../ai/model-catalog.js";
import type { ModelHandle } from "../ai/providers.js";
import { getSettings, type Mode } from "../core/config.js";
import type { TurnPolicy } from "../core/turn-policy.js";
import { resolvePreferredSpecialistRole, type SpecialistModelRole } from "./model-routing.js";
import { routeMessage } from "../ai/router.js";

const SDK_TOOL_PROVIDER_IDS = new Set([
  "anthropic", "openai", "codex", "google", "mistral", "groq", "xai",
  "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm",
]);

const VERBOSE_OUTPUT_PATTERNS = [
  /\b(explain|why|how\b|walk me through|step by step|detailed|verbose|deep dive|teach me|compare|analy[sz]e|summary|summari[sz]e)\b/i,
  /\bcode review\b/i,
];

export interface MinimalOutputPolicy {
  maxChars: number;
  maxOutputTokens: number;
}

export function supportsThinking(model: ModelHandle): boolean {
  return modelSupportsReasoning(model.modelId, model.provider.id);
}

export function shouldRequestThinkTags(model: ModelHandle, thinkingRequested: boolean): boolean {
  return thinkingRequested && model.runtime === "sdk";
}

export function shouldEnforceToolFirstTurn(options: {
  text: string;
  assistantText: string;
  toolActivity: boolean;
  policy: { archetype: string; allowedTools: readonly string[] };
  model: ModelHandle;
}): boolean {
  const { text, assistantText, toolActivity, policy, model } = options;
  if (toolActivity) return false;
  if (model.runtime !== "sdk" || !canUseSdkTools(model)) return false;
  if (policy.archetype !== "edit" && policy.archetype !== "bugfix") return false;
  if (!policy.allowedTools.includes("writeFile") && !policy.allowedTools.includes("editFile")) return false;
  const trimmed = assistantText.trim();
  if (!trimmed) return false;
  if (/[?]\s*$/.test(trimmed)) return false;
  if (/^(what|which|where|when|how|can you|should i|do you want)\b/i.test(trimmed)) return false;
  if (!/\b(make|create|add|write|edit|update|fix|implement|refactor|build)\b/i.test(text)) return false;
  return /\b(added|created|updated|wrote|made|fixed|implemented|refactored|done|complete|committed|pushed)\b/i.test(trimmed)
    || /\b[a-z0-9._-]+\.(html|css|js|ts|tsx|jsx|json|md)\b/i.test(trimmed);
}

export function canUseSdkTools(model: ModelHandle): boolean {
  return model.runtime === "sdk" && !!model.model && SDK_TOOL_PROVIDER_IDS.has(model.provider.id);
}

export function resolveExecutionTarget(options: {
  text: string;
  policy: TurnPolicy;
  currentMode: Mode;
  sessionMessageCount: number;
  lastToolCalls: string[];
  forceRoute?: "main" | "small";
  activeModel: ModelHandle;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  effectiveImages?: Array<{ mimeType: string; data: string }>;
  resolveSpecialistModel?: (role: SpecialistModelRole) => { model: ModelHandle; modelId: string } | null;
}): {
  resolvedRoute: "main" | "small";
  executionModel: ModelHandle;
  executionModelId: string;
  thinkingRequested: boolean;
  specialistRole: SpecialistModelRole | null;
} {
  const {
    text,
    policy,
    currentMode,
    sessionMessageCount,
    lastToolCalls,
    forceRoute,
    activeModel,
    currentModelId,
    smallModel,
    smallModelId,
    effectiveImages,
    resolveSpecialistModel,
  } = options;
  const settings = getSettings();
  const canAutoRoute = !!smallModel
    && settings.autoRoute
    && !(activeModel.provider.id === "codex" && activeModel.runtime === "native-cli");
  const requestedRoute = forceRoute ?? (canAutoRoute
    ? routeMessage(text, sessionMessageCount, lastToolCalls)
    : "main");
  const forceSmallExecutor = !forceRoute
    && canAutoRoute
    && !!smallModel
    && policy.preferSmallExecutor
    && !effectiveImages?.length;
  const resolvedRoute = forceSmallExecutor ? "small" : requestedRoute;
  if (resolvedRoute === "small" && smallModel) {
    const thinkingRequested = settings.enableThinking;
    return {
      resolvedRoute,
      executionModel: smallModel,
      executionModelId: smallModelId,
      thinkingRequested,
      specialistRole: null,
    };
  }
  const specialistRole = resolvePreferredSpecialistRole(text, policy.archetype);
  const planningModel = currentMode === "plan"
    ? resolveSpecialistModel?.("planning") ?? null
    : null;
  const specialist = specialistRole
    ? resolveSpecialistModel?.(specialistRole) ?? null
    : planningModel;
  const executionModel = specialist?.model ?? activeModel;
  const executionModelId = specialist?.modelId ?? currentModelId;
  const thinkingRequested = settings.enableThinking;
  return {
    resolvedRoute: "main",
    executionModel,
    executionModelId,
    thinkingRequested,
    specialistRole,
  };
}

export function looksLikeRawToolPayload(nextText: string): boolean {
  const normalized = nextText.trimStart();
  return /^<tool_call>/i.test(normalized)
    || /^call:(writeFile|editFile|readFile|listFiles|grep|bash)\s*\{/i.test(normalized)
    || /^(writeFile|editFile|readFile|listFiles|grep|bash)\s*\{/i.test(normalized)
    || /^(writeFile|editFile|readFile|listFiles|grep|bash)\s*\(/i.test(normalized);
}

export function shouldSuppressPlanningNarration(
  nextText: string,
  policy: { archetype: string },
  modelRuntime?: ModelHandle["runtime"],
): boolean {
  if (policy.archetype !== "edit" && policy.archetype !== "bugfix") return false;
  const normalized = nextText.trimStart().toLowerCase();
  return normalized.startsWith("using ")
    || normalized.startsWith("first step")
    || normalized.startsWith("need ")
    || normalized.startsWith("i'm checking")
    || normalized.startsWith("i am checking")
    || normalized.startsWith("checking ")
    || normalized.startsWith("reading ")
    || normalized.startsWith("looking ")
    || normalized.startsWith("inspecting ")
    || normalized.startsWith("i'll ")
    || normalized.startsWith("i will ")
    || normalized.startsWith("let me ")
    || normalized.startsWith("design dir")
    || normalized.startsWith("repo read next")
    || normalized.startsWith("before editing")
    || normalized.startsWith("before recreating")
    || normalized.startsWith("i need to");
}

export function shouldForceMinimalResponse(options: {
  text: string;
  policy: { archetype: string };
}): boolean {
  const { text, policy } = options;
  if (VERBOSE_OUTPUT_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (policy.archetype === "review" || policy.archetype === "planning" || policy.archetype === "research") return false;
  return true;
}

export function getMinimalOutputPolicy(options: {
  text: string;
  policy: { archetype: string; allowedTools: readonly string[] };
  modelRuntime?: ModelHandle["runtime"];
}): MinimalOutputPolicy | null {
  const { text, policy, modelRuntime } = options;
  if (!shouldForceMinimalResponse({ text, policy })) return null;
  if (modelRuntime === "native-cli" && (policy.archetype === "edit" || policy.archetype === "bugfix")) {
    return null;
  }

  switch (policy.archetype) {
    case "casual":
      return { maxChars: 32, maxOutputTokens: 24 };
    case "question":
    case "explore":
      return { maxChars: 72, maxOutputTokens: policy.allowedTools.length > 0 ? 64 : 40 };
    case "shell":
      return { maxChars: 80, maxOutputTokens: 72 };
    case "edit":
    case "bugfix":
      return { maxChars: 80, maxOutputTokens: 96 };
    default:
      return { maxChars: 80, maxOutputTokens: 72 };
  }
}

export function buildMinimalOutputInstruction(options: {
  archetype: string;
  maxChars: number;
}): string {
  return options.archetype === "edit" || options.archetype === "bugfix"
    ? `Final response: plain text only, max ${options.maxChars} chars, no bullets. Format: changed; verify or blocker. No explanation.`
    : `Final response: plain text only, max ${options.maxChars} chars. Answer only what was asked. No explanation.`;
}

export function formatTurnErrorMessage(options: {
  message: string;
  providerName: string;
  executionModelId: string;
}): string {
  const { providerName, executionModelId } = options;
  let msg = options.message;
  if (msg.includes("insufficient permissions") || msg.includes("Missing scopes")) {
    msg = "Your API key doesn't have access to this model. Try a different model with /model.";
  } else if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key") || msg.includes("401")) {
    msg = `Invalid API key for ${providerName}. Check your key and try again.`;
  } else if (msg.includes("Could not resolve") || msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    msg = `Can't reach ${providerName}. Check your connection or if the server is running.`;
  } else if (msg.includes("429") || msg.includes("rate_limit") || msg.includes("hit your limit")) {
    msg = "Rate limited. Wait a moment and try again.";
  } else if (msg.includes("is not supported when using Codex with a ChatGPT account")) {
    msg = `Codex ChatGPT login does not support model "${executionModelId}". Use a supported GPT-5 model, or turn off Auto-route for Codex native login.`;
  } else if (msg.includes("model_not_found") || msg.includes("does not exist") || msg.includes("not found")) {
    msg = `Model "${executionModelId}" not available. Try /model to pick a different one.`;
  } else if (msg.includes("overloaded") || msg.includes("503") || msg.includes("529")) {
    msg = `${providerName} is overloaded right now. Try again in a moment.`;
  }
  return msg.length > 300 ? `${msg.slice(0, 297)}...` : msg;
}

export function buildToolPreview(name: string, args: unknown): string {
  if (name === "Read" || name === "readFile") return (args as any)?.file_path ?? (args as any)?.path ?? "?";
  if (name === "Write" || name === "writeFile") return (args as any)?.file_path ?? (args as any)?.path ?? "?";
  if (name === "Edit" || name === "editFile") return (args as any)?.file_path ?? (args as any)?.path ?? "?";
  if (name === "Glob" || name === "glob") return (args as any)?.pattern ?? (args as any)?.path ?? "?";
  if (name === "LS" || name === "listFiles") return (args as any)?.path ?? "?";
  if (name === "grep") return (args as any)?.path ?? (args as any)?.pattern ?? "?";
  if (name === "semSearch") return (args as any)?.query ?? (args as any)?.path ?? "?";
  if (name === "bash") {
    const command = (args as any)?.command ?? "?";
    return command.length > 60 ? `${command.slice(0, 57)}...` : command;
  }
  return typeof args === "object" ? JSON.stringify(args).slice(0, 50) : String(args).slice(0, 50);
}
