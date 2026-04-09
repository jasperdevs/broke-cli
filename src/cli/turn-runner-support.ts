import { modelSupportsReasoning } from "../ai/model-catalog.js";
import type { ModelHandle } from "../ai/providers.js";
import { getSettings, type Mode } from "../core/config.js";
import type { TurnPolicy } from "../core/turn-policy.js";
import { resolvePreferredSpecialistRole, type SpecialistModelRole } from "./model-routing.js";
import { routeMessage } from "../ai/router.js";
import { readFileDirect } from "../tools/file-ops.js";
import { observeToolResult } from "./turn-tool-observer.js";

const SDK_TOOL_PROVIDER_IDS = new Set([
  "anthropic", "openai", "codex", "google", "mistral", "groq", "xai",
  "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm",
]);

const VERBOSE_OUTPUT_PATTERNS = [
  /\b(explain|why|how\b|walk me through|step by step|detailed|verbose|deep dive|teach me|compare|analy[sz]e|summary|summari[sz]e)\b/i,
  /\bcode review\b/i,
];

export interface MinimalOutputPolicy {
  maxOutputTokens: number;
}

export function exposeSimpleReadRuntime(options: {
  simpleFileTask: { path: string; preRead?: boolean; completeWithRead?: boolean } | null;
  nextToolCalls: string[];
  session: any;
  app: { addToolCall(name: string, preview: string, args?: unknown, callId?: string): void; addToolResult(name: string, result: string, error?: boolean, detail?: string, callId?: string): void };
}): { content: string; totalLines?: number; failed?: boolean } | null {
  const { simpleFileTask, nextToolCalls, session, app } = options;
  if (!simpleFileTask || (!simpleFileTask.preRead && !simpleFileTask.completeWithRead)) return null;
  const args = { path: simpleFileTask.path, mode: "full" as const, refresh: true };
  const callId = `simple-read:${simpleFileTask.path}`;
  nextToolCalls.push("readFile");
  app.addToolCall("readFile", simpleFileTask.path, args, callId);
  const result = readFileDirect(args);
  const detail = observeToolResult({ session, toolName: "readFile", result, toolArgs: args });
  if (result.success === false) {
    app.addToolResult("readFile", result.error.slice(0, 80), true, detail, callId);
    return { content: "", failed: true };
  }
  app.addToolResult("readFile", "ok", false, detail, callId);
  return { content: result.content, totalLines: result.totalLines };
}

export function supportsThinking(model: ModelHandle): boolean {
  return modelSupportsReasoning(model.modelId, model.provider.id);
}

export function shouldRequestThinkTags(model: ModelHandle, thinkingRequested: boolean): boolean {
  void model;
  void thinkingRequested;
  return false;
}

export function buildModelVisibleThinkingInstruction(cavemanLevel: string): string {
  const style = cavemanLevel === "off" ? "Keep it plain text, concise, and specific to this request." : "Use the same output-style for the reasoning: clipped, direct, no recap, no checklist, no warm-up, fragments fine.";
  return `If this model exposes reasoning in text, place that reasoning inside <think>...</think> before the final answer. ${style} If the model does not support that format, ignore this instruction and answer normally.`;
}

const RAW_THINK_BLOCK = /<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi;
const RAW_TOOLISH_LINE = /^\s*(?:call:)?(?:writeFile|editFile|readFile|listFiles|grep|bash|Read|Write|Edit|Bash)\s*(?:\(|\{)/i;
const INTERNAL_ORCHESTRATION_LINE = /^\s*(?:[-*•]\s*)?(?:user wants|the user asked|input\s*:|context\s*:|action\s*:|output style\s*:|final response\s*:|constraint(?: checklist)?(?: & confidence score)?\s*:|confidence score\s*:|plan\s*:|execution\s*:|casual turn\s*:|tool(?:s)? needed\b|no tools\b|reply now\b|mode\s*:)/i;
const INTERNAL_ORCHESTRATION_NUMBERED = /^\s*\d+\.\s+.+$/;
const INTERNAL_ORCHESTRATION_SENTENCE = /^\s*(?:the user (?:wants|asked)|answer (?:naturally|plain text only)|keep it (?:plain text|super short)|no recap\b|no narration\b|output style\b|local-model empty-output recovery\b)/i;

function stripRawThinkBlocks(text: string): string {
  return text.replace(RAW_THINK_BLOCK, "");
}

function stripLeadingOrchestrationPrelude(text: string): string {
  const lines = stripRawThinkBlocks(text).split(/\r?\n/);
  let index = 0;
  let sawPrelude = false;
  let sawStructuredPrelude = false;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      if (!sawPrelude) {
        index++;
        continue;
      }
      sawStructuredPrelude = true;
      index++;
      continue;
    }

    const matchesInternal = INTERNAL_ORCHESTRATION_LINE.test(trimmed)
      || INTERNAL_ORCHESTRATION_SENTENCE.test(trimmed)
      || RAW_TOOLISH_LINE.test(trimmed)
      || (sawStructuredPrelude && INTERNAL_ORCHESTRATION_NUMBERED.test(trimmed));
    if (!matchesInternal) break;
    sawPrelude = true;
    index++;
  }

  if (!sawPrelude) return stripRawThinkBlocks(text);
  return lines.slice(index).join("\n").trimStart();
}

function normalizeAssistantProse(text: string): string {
  return text
    .replace(/([.!?])([A-Z`])/g, "$1 $2")
    .replace(/([a-z0-9`])([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeVisibleAssistantText(
  text: string,
  policy: { archetype: string },
): string {
  const stripped = stripLeadingOrchestrationPrelude(text).trimStart();
  if ((policy.archetype === "edit" || policy.archetype === "bugfix") && RAW_TOOLISH_LINE.test(stripped)) {
    return "";
  }
  return normalizeAssistantProse(stripped);
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
    || normalized.startsWith("the user asked")
    || normalized.startsWith("the task is")
    || normalized.startsWith("i'm going to")
    || normalized.startsWith("i am going to")
    || normalized.startsWith("i will use")
    || normalized.startsWith("i'll use")
    || normalized.startsWith("i can ")
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

export function shouldUseToolFirstDisplay(options: {
  text: string;
  policy: { archetype: string; allowedTools: readonly string[] };
}): boolean {
  const { text, policy } = options;
  if (policy.archetype !== "edit" && policy.archetype !== "bugfix" && policy.archetype !== "explore") {
    return false;
  }
  const exposesFileAction = policy.allowedTools.some((tool) =>
    tool === "readFile"
    || tool === "writeFile"
    || tool === "editFile"
    || tool === "bash"
  );
  if (!exposesFileAction) return false;
  return /\b(read|show|open|cat|make|create|add|write|edit|update|change|fix|patch|modify)\b/i.test(text);
}

export function normalizeEditCompletionText(
  text: string,
  policy: { archetype: string },
): string {
  if (policy.archetype !== "edit" && policy.archetype !== "bugfix") return text.trim();
  let normalized = text.trim();
  normalized = normalized
    .replace(/^the user asked me to\s+/i, "")
    .replace(/^i (?:will|would|can|used|use)\s+/i, "")
    .replace(/^i(?:'ve| have)\s+(?:successfully\s+)?/i, "")
    .replace(/^successfully\s+/i, "")
    .replace(/^i\s+(?:have\s+)?successfully\s+/i, "")
    .replace(/^i(?:'m| am)\s+/i, "");
  normalized = normalized.replace(/\s+/g, " ").trim();
  if (/^created\b/i.test(normalized)) return normalized.replace(/^created\b/i, "Created");
  if (/^updated\b/i.test(normalized)) return normalized.replace(/^updated\b/i, "Updated");
  if (/^fixed\b/i.test(normalized)) return normalized.replace(/^fixed\b/i, "Fixed");
  if (/^wrote\b/i.test(normalized)) return normalized.replace(/^wrote\b/i, "Wrote");
  if (/^implemented\b/i.test(normalized)) return normalized.replace(/^implemented\b/i, "Implemented");
  return normalized ? normalized[0]!.toUpperCase() + normalized.slice(1) : normalized;
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
  switch (policy.archetype) {
    case "casual":
      return { maxOutputTokens: 24 };
    case "question":
    case "explore":
      return { maxOutputTokens: policy.allowedTools.length > 0 ? 64 : 40 };
    case "shell":
      return { maxOutputTokens: 72 };
    case "edit":
    case "bugfix":
      return { maxOutputTokens: 96 };
    default:
      return { maxOutputTokens: 72 };
  }
}

export function buildMinimalOutputInstruction(options: {
  archetype: string;
}): string {
  return options.archetype === "edit" || options.archetype === "bugfix"
    ? "Final response: plain text only, no bullets. Keep it concise. Start with the concrete result, then verification or blocker. No tool names, no protocol syntax, no intent narration."
    : "Final response: plain text only. Answer only what was asked. No explanation.";
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
  const shortenPath = (value: string): string => {
    const normalized = value.replace(/\//g, "\\");
    const cwd = process.cwd().replace(/\//g, "\\");
    if (normalized.toLowerCase().startsWith(`${cwd.toLowerCase()}\\`)) {
      return normalized.slice(cwd.length + 1).replace(/\\/g, "/");
    }
    if (/^[a-z]:\\/i.test(normalized) || normalized.startsWith("\\")) {
      const parts = normalized.split(/\\+/).filter(Boolean);
      return parts.slice(-2).join("/");
    }
    return value;
  };
  if (name === "Read" || name === "readFile") {
    const path = shortenPath((args as any)?.file_path ?? (args as any)?.path ?? "?");
    const offset = (args as any)?.offset;
    const limit = (args as any)?.limit;
    const tail = (args as any)?.tail;
    if (typeof tail === "number" && tail > 0) return `${path} · last ${tail}`;
    if (typeof offset === "number" || typeof limit === "number") {
      const start = typeof offset === "number" ? offset + 1 : 1;
      const end = typeof limit === "number" ? start + limit - 1 : "";
      return `${path}:${start}${end ? `-${end}` : ""}`;
    }
    return path;
  }
  if (name === "Write" || name === "writeFile") return shortenPath((args as any)?.file_path ?? (args as any)?.path ?? "?");
  if (name === "Edit" || name === "editFile") return shortenPath((args as any)?.file_path ?? (args as any)?.path ?? "?");
  if (name === "Glob" || name === "glob") {
    const pattern = (args as any)?.pattern ?? "?";
    const path = (args as any)?.path;
    return path && path !== "." ? `${pattern} in ${path}` : pattern;
  }
  if (name === "LS" || name === "listFiles") {
    const path = (args as any)?.path ?? ".";
    const include = (args as any)?.include;
    return include ? `${path} · ${include}` : path;
  }
  if (name === "grep") {
    const path = (args as any)?.path ?? ".";
    const pattern = (args as any)?.pattern ?? "?";
    return `${pattern} in ${path}`;
  }
  if (name === "semSearch") {
    const query = (args as any)?.query ?? "?";
    return query.length > 48 ? `${query.slice(0, 45)}...` : query;
  }
  if (name === "webSearch") {
    const query = (args as any)?.query ?? "?";
    return query.length > 60 ? `${query.slice(0, 57)}...` : query;
  }
  if (name === "webFetch") {
    const url = (args as any)?.url ?? "?";
    return url.length > 72 ? `${url.slice(0, 69)}...` : url;
  }
  if (name === "bash") {
    const command = (args as any)?.command ?? "?";
    return command.length > 60 ? `${command.slice(0, 57)}...` : command;
  }
  return typeof args === "object" ? JSON.stringify(args).slice(0, 50) : String(args).slice(0, 50);
}
