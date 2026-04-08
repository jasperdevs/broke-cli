import { estimateTextTokens } from "../ai/tokens.js";
import { routeMessage, type RouteDecision } from "../ai/router.js";
import { rewriteAssistantForCaveman } from "./caveman.js";
import { getTurnPolicy, type TurnArchetype, type TurnPolicy } from "./turn-policy.js";

interface RoutingExpectation {
  messageCount: number;
  lastToolCalls?: string[];
  expected: RouteDecision;
}

interface PolicyExpectation {
  archetype: TurnArchetype;
  maxToolSteps: number;
  preferSmallExecutor: boolean;
  requiredTools?: string[];
  forbiddenTools?: string[];
}

interface CavemanExpectation {
  text: string;
  liteMustReduceTokens: boolean;
  ultraMustReduceTokens: boolean;
}

export interface EfficiencyBenchmarkCase {
  id: string;
  prompt: string;
  routing: RoutingExpectation;
  policy: PolicyExpectation;
  caveman?: CavemanExpectation;
}

export interface EfficiencyBenchmarkFailure {
  caseId: string;
  area: "routing" | "policy" | "caveman";
  message: string;
}

export interface EfficiencyBenchmarkResult {
  totalCases: number;
  failures: EfficiencyBenchmarkFailure[];
  routeHits: number;
  policyHits: number;
  cavemanHits: number;
}

export const EFFICIENCY_BENCHMARK_CASES: EfficiencyBenchmarkCase[] = [
  {
    id: "casual-greeting",
    prompt: "hey",
    routing: { messageCount: 3, expected: "small" },
    policy: {
      archetype: "casual",
      maxToolSteps: 0,
      preferSmallExecutor: true,
      forbiddenTools: ["bash", "writeFile", "editFile", "webSearch"],
    },
    caveman: {
      text: "Hey there. I can help with that.",
      liteMustReduceTokens: false,
      ultraMustReduceTokens: true,
    },
  },
  {
    id: "repo-explore",
    prompt: "read src/cli/turn-runner.ts and show me where auto compact happens",
    routing: { messageCount: 4, expected: "small" },
    policy: {
      archetype: "explore",
      maxToolSteps: 1,
      preferSmallExecutor: true,
      requiredTools: ["readFile"],
      forbiddenTools: ["listFiles", "grep", "writeFile", "editFile", "webSearch"],
    },
  },
  {
    id: "shell-investigation",
    prompt: "run git status and list changed files",
    routing: { messageCount: 5, expected: "small" },
    policy: {
      archetype: "shell",
      maxToolSteps: 2,
      preferSmallExecutor: true,
      requiredTools: ["bash", "readFile"],
      forbiddenTools: ["writeFile", "editFile"],
    },
  },
  {
    id: "web-research",
    prompt: "research the latest TypeScript project references docs and summarize the tradeoffs",
    routing: { messageCount: 5, expected: "main" },
    policy: {
      archetype: "research",
      maxToolSteps: 3,
      preferSmallExecutor: true,
      requiredTools: ["webSearch", "webFetch"],
      forbiddenTools: ["writeFile", "editFile"],
    },
  },
  {
    id: "edit-change",
    prompt: "implement a safer permission check in the shell tool and update tests",
    routing: { messageCount: 6, expected: "main" },
    policy: {
      archetype: "edit",
      maxToolSteps: 6,
      preferSmallExecutor: false,
      requiredTools: ["writeFile", "editFile", "bash"],
    },
    caveman: {
      text: "I updated the permission check in the shell tool and added tests to cover the new behavior.",
      liteMustReduceTokens: false,
      ultraMustReduceTokens: true,
    },
  },
  {
    id: "bugfix",
    prompt: "fix the failing native provider retry path when the model emits empty output",
    routing: { messageCount: 6, expected: "main" },
    policy: {
      archetype: "bugfix",
      maxToolSteps: 7,
      preferSmallExecutor: false,
      requiredTools: ["writeFile", "editFile", "readFile"],
    },
  },
  {
    id: "review",
    prompt: "review this repo for brittle hardcoded runtime behavior",
    routing: { messageCount: 6, expected: "main" },
    policy: {
      archetype: "review",
      maxToolSteps: 3,
      preferSmallExecutor: true,
      requiredTools: ["readFile", "grep"],
      forbiddenTools: ["writeFile", "editFile"],
    },
  },
];

function comparePolicy(caseId: string, policy: TurnPolicy, expected: PolicyExpectation): EfficiencyBenchmarkFailure[] {
  const failures: EfficiencyBenchmarkFailure[] = [];
  if (policy.archetype !== expected.archetype) {
    failures.push({ caseId, area: "policy", message: `expected archetype ${expected.archetype}, got ${policy.archetype}` });
  }
  if (policy.maxToolSteps !== expected.maxToolSteps) {
    failures.push({ caseId, area: "policy", message: `expected maxToolSteps ${expected.maxToolSteps}, got ${policy.maxToolSteps}` });
  }
  if (policy.preferSmallExecutor !== expected.preferSmallExecutor) {
    failures.push({ caseId, area: "policy", message: `expected preferSmallExecutor ${expected.preferSmallExecutor}, got ${policy.preferSmallExecutor}` });
  }
  for (const tool of expected.requiredTools ?? []) {
    if (!policy.allowedTools.includes(tool as any)) {
      failures.push({ caseId, area: "policy", message: `missing required tool ${tool}` });
    }
  }
  for (const tool of expected.forbiddenTools ?? []) {
    if (policy.allowedTools.includes(tool as any)) {
      failures.push({ caseId, area: "policy", message: `forbidden tool exposed ${tool}` });
    }
  }
  return failures;
}

function compareCaveman(caseId: string, expectation: CavemanExpectation): EfficiencyBenchmarkFailure[] {
  const failures: EfficiencyBenchmarkFailure[] = [];
  const baseline = estimateTextTokens(expectation.text);
  const lite = rewriteAssistantForCaveman(expectation.text, "lite");
  const ultra = rewriteAssistantForCaveman(expectation.text, "ultra");
  const liteTokens = estimateTextTokens(lite);
  const ultraTokens = estimateTextTokens(ultra);
  if (expectation.liteMustReduceTokens && liteTokens >= baseline) {
    failures.push({ caseId, area: "caveman", message: `lite caveman did not reduce tokens (${liteTokens} >= ${baseline})` });
  }
  if (expectation.ultraMustReduceTokens && ultraTokens >= baseline) {
    failures.push({ caseId, area: "caveman", message: `ultra caveman did not reduce tokens (${ultraTokens} >= ${baseline})` });
  }
  if (ultraTokens > liteTokens) {
    failures.push({ caseId, area: "caveman", message: `ultra caveman expanded compared with lite (${ultraTokens} > ${liteTokens})` });
  }
  return failures;
}

export function runEfficiencyBenchmarks(cases: EfficiencyBenchmarkCase[] = EFFICIENCY_BENCHMARK_CASES): EfficiencyBenchmarkResult {
  const failures: EfficiencyBenchmarkFailure[] = [];
  let routeHits = 0;
  let policyHits = 0;
  let cavemanHits = 0;

  for (const benchmarkCase of cases) {
    const route = routeMessage(
      benchmarkCase.prompt,
      benchmarkCase.routing.messageCount,
      benchmarkCase.routing.lastToolCalls ?? [],
    );
    if (route === benchmarkCase.routing.expected) routeHits += 1;
    else failures.push({
      caseId: benchmarkCase.id,
      area: "routing",
      message: `expected route ${benchmarkCase.routing.expected}, got ${route}`,
    });

    const policy = getTurnPolicy(benchmarkCase.prompt, benchmarkCase.routing.lastToolCalls ?? []);
    const policyFailures = comparePolicy(benchmarkCase.id, policy, benchmarkCase.policy);
    if (policyFailures.length === 0) policyHits += 1;
    else failures.push(...policyFailures);

    if (benchmarkCase.caveman) {
      const cavemanFailures = compareCaveman(benchmarkCase.id, benchmarkCase.caveman);
      if (cavemanFailures.length === 0) cavemanHits += 1;
      else failures.push(...cavemanFailures);
    }
  }

  return {
    totalCases: cases.length,
    failures,
    routeHits,
    policyHits,
    cavemanHits,
  };
}
