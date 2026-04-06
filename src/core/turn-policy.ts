import type { ToolName } from "../tools/registry.js";

export type TurnArchetype =
  | "question"
  | "explore"
  | "shell"
  | "edit"
  | "bugfix"
  | "review"
  | "research"
  | "planning";

export interface TurnPolicy {
  archetype: TurnArchetype;
  allowedTools: ToolName[];
  maxToolSteps: number;
  scaffold: string;
  plannerCacheHit: boolean;
}

const PLAN_CACHE = new Map<TurnArchetype, string>();

const ALL_EDIT_TOOLS: ToolName[] = ["bash", "readFile", "writeFile", "editFile", "listFiles", "grep", "todoWrite", "subagent"];
const READ_ONLY_TOOLS: ToolName[] = ["readFile", "listFiles", "grep", "todoWrite", "subagent"];
const SHELL_TOOLS: ToolName[] = ["bash", "readFile", "listFiles", "grep", "todoWrite"];
const RESEARCH_TOOLS: ToolName[] = ["readFile", "listFiles", "grep", "webSearch", "webFetch", "todoWrite", "subagent"];

export function classifyTurnArchetype(userMessage: string, lastToolCalls: string[] = []): TurnArchetype {
  const msg = userMessage.toLowerCase().trim();

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

function getScaffold(archetype: TurnArchetype): { text: string; hit: boolean } {
  const cached = PLAN_CACHE.get(archetype);
  if (cached) return { text: cached, hit: true };

  const text = ({
    question: "Answer directly. Use tools only if they materially improve correctness. Keep response compact.",
    explore: "Inspect before acting. Prefer read/list/grep. Do not edit unless the user clearly asked for a change.",
    shell: "Prefer a short command path. Run the minimum shell steps needed. Summarize result tersely.",
    edit: "Read target files first. Make the smallest correct edit. Verify with one relevant check when possible.",
    bugfix: "Reproduce mentally from evidence, inspect likely files, patch the root cause, then verify with the narrowest useful check.",
    review: "Stay read-only. Gather evidence, focus on concrete issues, and keep findings ordered by severity.",
    research: "Prefer web/docs plus local inspection. Synthesize only verified facts. Keep citations or source attribution concise.",
    planning: "Produce a bounded implementation plan with clear steps, risks, and verification. Do not over-elaborate.",
  } as const)[archetype];

  PLAN_CACHE.set(archetype, text);
  return { text, hit: false };
}

export function getTurnPolicy(userMessage: string, lastToolCalls: string[] = []): TurnPolicy {
  const archetype = classifyTurnArchetype(userMessage, lastToolCalls);
  const scaffold = getScaffold(archetype);

  switch (archetype) {
    case "question":
      return { archetype, allowedTools: READ_ONLY_TOOLS, maxToolSteps: 1, scaffold: scaffold.text, plannerCacheHit: scaffold.hit };
    case "explore":
      return { archetype, allowedTools: READ_ONLY_TOOLS, maxToolSteps: 2, scaffold: scaffold.text, plannerCacheHit: scaffold.hit };
    case "shell":
      return { archetype, allowedTools: SHELL_TOOLS, maxToolSteps: 2, scaffold: scaffold.text, plannerCacheHit: scaffold.hit };
    case "review":
      return { archetype, allowedTools: READ_ONLY_TOOLS, maxToolSteps: 3, scaffold: scaffold.text, plannerCacheHit: scaffold.hit };
    case "research":
      return { archetype, allowedTools: RESEARCH_TOOLS, maxToolSteps: 3, scaffold: scaffold.text, plannerCacheHit: scaffold.hit };
    case "planning":
      return { archetype, allowedTools: READ_ONLY_TOOLS, maxToolSteps: 2, scaffold: scaffold.text, plannerCacheHit: scaffold.hit };
    case "edit":
      return { archetype, allowedTools: ALL_EDIT_TOOLS, maxToolSteps: 6, scaffold: scaffold.text, plannerCacheHit: scaffold.hit };
    case "bugfix":
    default:
      return { archetype, allowedTools: ALL_EDIT_TOOLS, maxToolSteps: 7, scaffold: scaffold.text, plannerCacheHit: scaffold.hit };
  }
}
