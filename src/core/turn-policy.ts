import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { generateText, type LanguageModel } from "ai";
import { calculateCost, type TokenUsage } from "../ai/cost.js";
import { estimateTextTokens } from "../ai/tokens.js";
import { getSettings } from "./config.js";
import type { ToolName } from "../tools/registry.js";

export type TurnArchetype =
  | "casual"
  | "question"
  | "explore"
  | "shell"
  | "edit"
  | "bugfix"
  | "review"
  | "research"
  | "planning";

export type PromptProfile = "full" | "casual";
export type ScaffoldSource = "builtin" | "planned";

export interface PlannerContext {
  model: LanguageModel;
  modelId: string;
  providerId: string;
}

export interface TurnPolicy {
  archetype: TurnArchetype;
  allowedTools: ToolName[];
  maxToolSteps: number;
  scaffold: string;
  plannerCacheHit?: boolean;
  plannerUsage?: TokenUsage;
  scaffoldSource: ScaffoldSource;
  preferSmallExecutor: boolean;
  promptProfile: PromptProfile;
  historyWindow: number | null;
}

const PLANNED_SCAFFOLD_CACHE = new Map<string, string>();
const CACHE_DIR = join(homedir(), ".brokecli");
const CACHE_FILE = join(CACHE_DIR, "turn-policy-cache.json");
const MAX_PLANNED_SCAFFOLDS = 128;
let cacheHydrated = false;

const ALL_EDIT_TOOLS: ToolName[] = ["semSearch", "bash", "readFile", "writeFile", "editFile", "listFiles", "grep", "todoWrite"];
const NO_TOOLS: ToolName[] = [];
const READ_ONLY_TOOLS: ToolName[] = ["semSearch", "readFile", "listFiles", "grep"];
const SHELL_TOOLS: ToolName[] = ["semSearch", "bash", "readFile", "listFiles", "grep"];
const RESEARCH_TOOLS: ToolName[] = ["semSearch", "readFile", "listFiles", "grep", "webSearch", "webFetch"];

const CASUAL_MESSAGE_PATTERNS = [
  /^(?:hi|hey|hello|hey there|hello there|yo|sup|what(?:'s| is)\s+up|how(?:'s| is)\s+it\s+going|how are you|thanks|thank you|thx|cool|nice|ok|okay|lol|lmao|gm|gn)[!.?\s]*$/i,
  /^(?:good (?:morning|afternoon|evening)|see ya|cya|bye|goodbye)[!.?\s]*$/i,
];

const PLANNABLE_ARCHETYPES = new Set<TurnArchetype>(["question", "explore", "shell", "review", "research", "planning", "edit", "bugfix"]);

const STATIC_SCAFFOLDS: Record<TurnArchetype, string> = {
  casual: "lane cheap\nanswer brief\nno tools",
  question: "lane direct\nanswer first\nuse tools only if clearly needed",
  explore: "lane cheap\nsearch first\nread only what matches\nno broad shell search",
  shell: "lane cheap\nprefer native read/search tools\nuse shell only for real commands",
  edit: "lane main\nread targets first\nmake the smallest correct edit\nverify once",
  bugfix: "lane main\nfind root cause from evidence\npatch once\nverify narrowly",
  review: "lane cheap\nstay read-only\nreport concrete issues ordered by severity",
  research: "lane cheap\nprefer docs plus local evidence\nreturn verified facts only",
  planning: "lane cheap\nproduce bounded steps risks and checks\nno long prose",
};

function isCasualTurn(userMessage: string): boolean {
  const msg = userMessage.trim();
  if (!msg || msg.length > 80) return false;
  return CASUAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(msg));
}

export function classifyTurnArchetype(userMessage: string, lastToolCalls: string[] = []): TurnArchetype {
  const msg = userMessage.toLowerCase().trim();

  if (isCasualTurn(msg)) return "casual";
  if (/\b(plan|roadmap|strategy|tradeoff|approach)\b/i.test(msg)) return "planning";
  if (/\b(review|audit|inspect|critique)\b/i.test(msg)) return "review";
  if (/\b(search web|research|look up|docs?|documentation|source)\b/i.test(msg)) return "research";
  if (/^(run|exec|execute|bash|shell|git)\b/i.test(msg)) return "shell";
  if (/\b(fix|bug|broken|error|failing|debug|why\b.*\bnot\b.*\bwork)\b/i.test(msg)) return "bugfix";
  if (/\b(write|edit|change|update|create|make|implement|refactor|add)\b/i.test(msg)) return "edit";
  if (/^(read|show|open|view|find|list|where|which file|what file|grep)\b/i.test(msg)) return "explore";
  if (lastToolCalls.length >= 3) return "explore";
  return "question";
}

function getBuiltInPolicy(archetype: TurnArchetype): TurnPolicy {
  switch (archetype) {
    case "casual":
      return {
        archetype,
        allowedTools: NO_TOOLS,
        maxToolSteps: 0,
        scaffold: STATIC_SCAFFOLDS[archetype],
        scaffoldSource: "builtin",
        preferSmallExecutor: true,
        promptProfile: "casual",
        historyWindow: 2,
      };
    case "question":
      return {
        archetype,
        allowedTools: READ_ONLY_TOOLS,
        maxToolSteps: 1,
        scaffold: STATIC_SCAFFOLDS[archetype],
        scaffoldSource: "builtin",
        preferSmallExecutor: true,
        promptProfile: "full",
        historyWindow: null,
      };
    case "explore":
      return {
        archetype,
        allowedTools: READ_ONLY_TOOLS,
        maxToolSteps: 2,
        scaffold: STATIC_SCAFFOLDS[archetype],
        scaffoldSource: "builtin",
        preferSmallExecutor: true,
        promptProfile: "full",
        historyWindow: null,
      };
    case "shell":
      return {
        archetype,
        allowedTools: SHELL_TOOLS,
        maxToolSteps: 2,
        scaffold: STATIC_SCAFFOLDS[archetype],
        scaffoldSource: "builtin",
        preferSmallExecutor: true,
        promptProfile: "full",
        historyWindow: null,
      };
    case "review":
      return {
        archetype,
        allowedTools: READ_ONLY_TOOLS,
        maxToolSteps: 3,
        scaffold: STATIC_SCAFFOLDS[archetype],
        scaffoldSource: "builtin",
        preferSmallExecutor: true,
        promptProfile: "full",
        historyWindow: null,
      };
    case "research":
      return {
        archetype,
        allowedTools: RESEARCH_TOOLS,
        maxToolSteps: 3,
        scaffold: STATIC_SCAFFOLDS[archetype],
        scaffoldSource: "builtin",
        preferSmallExecutor: true,
        promptProfile: "full",
        historyWindow: null,
      };
    case "planning":
      return {
        archetype,
        allowedTools: READ_ONLY_TOOLS,
        maxToolSteps: 2,
        scaffold: STATIC_SCAFFOLDS[archetype],
        scaffoldSource: "builtin",
        preferSmallExecutor: true,
        promptProfile: "full",
        historyWindow: null,
      };
    case "edit":
      return {
        archetype,
        allowedTools: ALL_EDIT_TOOLS,
        maxToolSteps: 6,
        scaffold: STATIC_SCAFFOLDS[archetype],
        scaffoldSource: "builtin",
        preferSmallExecutor: false,
        promptProfile: "full",
        historyWindow: null,
      };
    case "bugfix":
    default:
      return {
        archetype,
        allowedTools: ALL_EDIT_TOOLS,
        maxToolSteps: 7,
        scaffold: STATIC_SCAFFOLDS.bugfix,
        scaffoldSource: "builtin",
        preferSmallExecutor: false,
        promptProfile: "full",
        historyWindow: null,
      };
  }
}

function extractExplicitPaths(userMessage: string): string[] {
  return [...new Set(userMessage.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [])];
}

function hasCreateIntent(userMessage: string): boolean {
  return /\b(create|new file|new files|scaffold|generate|make\b.*\bfile|add\b.*\bfile)\b/i.test(userMessage);
}

function refinePolicyForRequest(policy: TurnPolicy, userMessage: string): TurnPolicy {
  const explicitPaths = extractExplicitPaths(userMessage);
  const existingPaths = explicitPaths.filter((path) => existsSync(path));

  if ((policy.archetype === "explore" || policy.archetype === "question") && explicitPaths.length > 0) {
    return {
      ...policy,
      allowedTools: ["readFile"],
      maxToolSteps: 1,
    };
  }

  if (policy.archetype === "research" && /https?:\/\//i.test(userMessage)) {
    return {
      ...policy,
      allowedTools: ["webFetch"],
      maxToolSteps: 1,
    };
  }

  if ((policy.archetype === "edit" || policy.archetype === "bugfix") && existingPaths.length > 0 && !hasCreateIntent(userMessage)) {
    return {
      ...policy,
      allowedTools: policy.allowedTools.filter((tool) => tool !== "writeFile"),
    };
  }

  return policy;
}

export function getTurnPolicy(userMessage: string, lastToolCalls: string[] = []): TurnPolicy {
  return refinePolicyForRequest(getBuiltInPolicy(classifyTurnArchetype(userMessage, lastToolCalls)), userMessage);
}

function getPlanCacheKey(policy: TurnPolicy, userMessage: string): string {
  const normalized = userMessage
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 240);
  return `v3:${policy.archetype}:${policy.maxToolSteps}:${policy.allowedTools.join(",")}:${normalized}`;
}

function hydratePlannedScaffoldCache(): void {
  if (cacheHydrated) return;
  cacheHydrated = true;
  if (!existsSync(CACHE_FILE)) return;
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value.trim().length > 0) {
        PLANNED_SCAFFOLD_CACHE.set(key, value);
      }
    }
  } catch {
    // ignore cache hydration failures
  }
}

function persistPlannedScaffoldCache(): void {
  try {
    while (PLANNED_SCAFFOLD_CACHE.size > MAX_PLANNED_SCAFFOLDS) {
      const oldest = PLANNED_SCAFFOLD_CACHE.keys().next().value;
      if (!oldest) break;
      PLANNED_SCAFFOLD_CACHE.delete(oldest);
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(PLANNED_SCAFFOLD_CACHE), null, 2), "utf-8");
  } catch {
    // ignore cache persistence failures
  }
}

function sanitizePlannedScaffold(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");
}

function isUsablePlannedScaffold(scaffold: string): boolean {
  if (!scaffold) return false;
  const normalized = scaffold.toLowerCase();
  return normalized.includes("lane:")
    && normalized.includes("steps:")
    && normalized.includes("verify:");
}

function buildPlannerPrompt(policy: TurnPolicy, userMessage: string): string {
  const toolList = policy.allowedTools.length > 0 ? policy.allowedTools.join(", ") : "none";
  return [
    `Task archetype: ${policy.archetype}`,
    `User request: ${userMessage.trim()}`,
    `Allowed tools: ${toolList}`,
    `Step cap: ${policy.maxToolSteps}`,
    "",
    "Return only compact plain-text lines in this shape:",
    "lane: cheap|main",
    "goal: ...",
    "steps: 1) ... 2) ...",
    "tools: ...",
    "rules: ...",
    "verify: ...",
    "",
    "No prose. No markdown fences. No explanation.",
  ].join("\n");
}

function normalizePlannerUsage(result: unknown, planner: PlannerContext, prompt: string, scaffold: string): TokenUsage {
  const usage = (result as { usage?: { inputTokens?: number; outputTokens?: number } }).usage;
  const inputTokens = typeof usage?.inputTokens === "number" && usage.inputTokens > 0
    ? usage.inputTokens
    : estimateTextTokens(prompt, planner.modelId);
  const outputTokens = typeof usage?.outputTokens === "number" && usage.outputTokens > 0
    ? usage.outputTokens
    : estimateTextTokens(scaffold, planner.modelId);
  return calculateCost(planner.modelId, inputTokens, outputTokens, planner.providerId);
}

export async function resolveTurnPolicy(
  userMessage: string,
  lastToolCalls: string[] = [],
  planner?: PlannerContext | null,
): Promise<TurnPolicy> {
  const basePolicy = getTurnPolicy(userMessage, lastToolCalls);
  if (getSettings().enablePlannedScaffolds === false) return basePolicy;
  if (!planner?.model || !PLANNABLE_ARCHETYPES.has(basePolicy.archetype)) return basePolicy;

  hydratePlannedScaffoldCache();
  const cacheKey = getPlanCacheKey(basePolicy, userMessage);
  const cached = PLANNED_SCAFFOLD_CACHE.get(cacheKey);
  if (cached) {
    return {
      ...basePolicy,
      scaffold: cached,
      scaffoldSource: "planned",
      plannerCacheHit: true,
      preferSmallExecutor: basePolicy.archetype === "edit" || basePolicy.archetype === "bugfix" ? false : true,
    };
  }

  try {
    const plannerPrompt = buildPlannerPrompt(basePolicy, userMessage);
    const result = await generateText({
      model: planner.model,
      system: "You design compact execution scaffolds for a coding terminal. Output raw lines only. Keep it under 120 tokens.",
      prompt: plannerPrompt,
      maxOutputTokens: 160,
    });
    const scaffold = sanitizePlannedScaffold(result.text);
    if (!isUsablePlannedScaffold(scaffold)) return basePolicy;
    PLANNED_SCAFFOLD_CACHE.set(cacheKey, scaffold);
    persistPlannedScaffoldCache();
    return {
      ...basePolicy,
      scaffold,
      scaffoldSource: "planned",
      plannerCacheHit: false,
      plannerUsage: normalizePlannerUsage(result, planner, plannerPrompt, scaffold),
      preferSmallExecutor: basePolicy.archetype === "edit" || basePolicy.archetype === "bugfix" ? false : true,
    };
  } catch {
    return basePolicy;
  }
}

export function shouldPreferSmallExecutor(
  policy: TurnPolicy,
  messageCount: number,
  hasImages = false,
): boolean {
  if (!policy.preferSmallExecutor || hasImages) return false;
  if (policy.archetype === "casual" || policy.archetype === "question" || policy.archetype === "explore" || policy.archetype === "shell") {
    return true;
  }
  if (policy.scaffoldSource === "planned" && messageCount > 1) {
    return policy.archetype === "review" || policy.archetype === "research" || policy.archetype === "planning";
  }
  return false;
}

export function resetPlannedScaffoldCacheForTests(): void {
  PLANNED_SCAFFOLD_CACHE.clear();
  cacheHydrated = false;
}
