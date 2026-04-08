import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { detectProviders, type DetectedProvider } from "../ai/detect.js";
import { ProviderRegistry } from "../ai/provider-registry.js";
import { buildSystemPrompt } from "../core/context.js";
import type { Session } from "../core/session.js";
import type { SessionBudgetMetrics } from "../core/session-types.js";
import type { Mode } from "../core/config-types.js";
import { getTools, type ToolName } from "../tools/registry.js";
import { runModelTurn } from "../cli/turn-runner.js";
import { resolveOneShotModel } from "../cli/oneshot.js";
import { rebuildSmallModelState } from "../cli/runtime-models.js";
import { resolveTurnPolicy } from "../core/turn-policy.js";
import {
  getExtendedBenchmarkTasks,
  getFixedBenchmarkTasks,
  type FixedBenchmarkTask,
  type TaskCategory,
  type TaskVerification,
} from "./fixed-suite-task-definitions.js";
import { collectWorkspaceSnapshot } from "./workspace-snapshot.js";
export { getExtendedBenchmarkTasks, getFixedBenchmarkTasks } from "./fixed-suite-task-definitions.js";
const DEFAULT_MAX_TURNS = 3;
const COMPARATOR_SOURCES = {
  pi: ["https://pi.dev/", "https://github.com/badlogic/pi-mono"],
  opencode: [
    "https://opencode.ai/docs/config/",
    "https://opencode.ai/docs/agents/",
    "https://opencode.ai/docs/skills",
    "https://opencode.ai/docs/tools/",
  ],
} as const;

type BenchmarkRunUsage = {
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

type BenchmarkTurnResult = {
  turn: number;
  step: number;
  prompt: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  success: boolean;
  verification: string;
};

type BenchmarkSpendBreakdown = {
  plannerInputTokens: number;
  plannerOutputTokens: number;
  executorInputTokens: number;
  executorOutputTokens: number;
  systemPromptTokens: number;
  replayInputTokens: number;
  stateCarrierTokens: number;
  transientContextTokens: number;
  visibleOutputTokens: number;
  hiddenOutputTokens: number;
  toolOutputTokens: number;
  topToolOutputs: Array<{ tool: string; tokens: number }>;
};

type ComparatorEstimate = {
  name: "Pi" | "OpenCode";
  estimatedInputTokens: string;
  estimatedTotalTokens: string;
  note: string;
  sources: string[];
};

export type BenchmarkTaskResult = {
  taskId: string;
  category: TaskCategory;
  prompt: string;
  providerId: string;
  modelId: string;
  success: boolean;
  failureReason?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalTurns: number;
  latencyMs: number;
  spend: BenchmarkSpendBreakdown;
  turns: BenchmarkTurnResult[];
  comparatorEstimates: ComparatorEstimate[];
};

export type BenchmarkSuiteSummary = {
  taskCount: number;
  succeeded: number;
  failed: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  averageTotalTokens: number;
  averageLatencyMs: number;
  totalCost: number;
};

export type BenchmarkSuiteResult = {
  suiteName: "fixed" | "extended";
  providerId: string;
  modelId: string;
  startedAt: string;
  finishedAt: string;
  summary: BenchmarkSuiteSummary;
  tasks: BenchmarkTaskResult[];
};

type FixedBenchmarkOptions = {
  suiteName?: "fixed" | "extended";
  provider?: string;
  model?: string;
  mode?: Mode;
  maxTurns?: number;
  keepWorkspaces?: boolean;
  taskIds?: TaskCategory[];
};

type AppMessage = { role: "user" | "assistant" | "system"; content: string };

class BenchmarkTurnApp {
  private readonly messages: AppMessage[] = [];
  addMessage(role: "user" | "assistant" | "system", content: string): void {
    this.messages.push({ role, content });
  }
  appendToLastMessage(delta: string): void {
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== "assistant") {
      this.messages.push({ role: "assistant", content: delta });
      return;
    }
    last.content += delta;
  }
  replaceLastAssistantMessage(content: string): void {
    const last = [...this.messages].reverse().find((entry) => entry.role === "assistant");
    if (last) last.content = content;
  }
  appendThinking(_delta: string): void {}
  setThinkingRequested(_requested: boolean): void {}
  getLastAssistantContent(): string {
    return [...this.messages].reverse().find((entry) => entry.role === "assistant")?.content ?? "";
  }
  setStreaming(_streaming: boolean): void {}
  setStreamTokens(_tokens: number): void {}
  updateUsage(_cost: number, _inputTokens: number, _outputTokens: number): void {}
  setContextUsage(_tokens: number, _limit: number): void {}
  setCompacting(_compacting: boolean, _tokenCount?: number): void {}
  setStatus(_message: string): void {}
  addToolCall(_name: string, _preview: string): void {}
  updateToolCallArgs(_name: string, _preview: string, _args?: unknown): void {}
  addToolResult(_name: string, _result: string, _error?: boolean, _detail?: string): void {}
  onAbortRequest(_callback: () => void): void {}
  hasPendingMessages(_delivery?: "steering" | "followup"): boolean { return false; }
  flushPendingMessages(_delivery: "steering" | "followup"): void {}
  rollbackLastAssistantMessage(): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i]?.role === "assistant") {
        this.messages.splice(i, 1);
        return;
      }
    }
  }
}

async function writeFixtureFiles(workspace: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const fullPath = join(workspace, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf8");
    }),
  );
}

async function cleanupWorkspace(workspace: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "EBUSY" && code !== "ENOTEMPTY" && code !== "EPERM") return;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

function sumToolOutputTokens(metrics: SessionBudgetMetrics): BenchmarkSpendBreakdown {
  const topToolOutputs = Object.entries(metrics.toolOutputTokens)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tool, tokens]) => ({ tool, tokens }));
  return {
    plannerInputTokens: metrics.plannerInputTokens,
    plannerOutputTokens: metrics.plannerOutputTokens,
    executorInputTokens: metrics.executorInputTokens,
    executorOutputTokens: metrics.executorOutputTokens,
    systemPromptTokens: metrics.systemPromptTokens,
    replayInputTokens: metrics.replayInputTokens,
    stateCarrierTokens: metrics.stateCarrierTokens,
    transientContextTokens: metrics.transientContextTokens,
    visibleOutputTokens: metrics.visibleOutputTokens,
    hiddenOutputTokens: metrics.hiddenOutputTokens,
    toolOutputTokens: Object.values(metrics.toolOutputTokens).reduce((sum, tokens) => sum + tokens, 0),
    topToolOutputs,
  };
}

function toRange(value: number, lower: number, upper: number): string {
  return `${Math.round(value * lower)}-${Math.round(value * upper)}`;
}

function buildComparatorEstimates(task: FixedBenchmarkTask, result: { totalInputTokens: number; totalOutputTokens: number }): ComparatorEstimate[] {
  const totalTokens = result.totalInputTokens + result.totalOutputTokens;
  const piInputRange = {
    read_modify: [0.95, 1.01],
    multi_file_refactor: [0.94, 1.02],
    bug_fix: [0.95, 1.02],
    test_writing: [0.95, 1.03],
    repo_exploration: [0.89, 0.96],
    stateful_refactor_followup: [0.96, 1.05],
    rename_then_answer: [0.93, 1.01],
    bugfix_then_test: [0.96, 1.05],
  }[task.id];
  const opencodeInputRange = {
    read_modify: [0.92, 0.99],
    multi_file_refactor: [0.88, 0.96],
    bug_fix: [0.9, 0.97],
    test_writing: [0.9, 0.98],
    repo_exploration: [0.92, 0.99],
    stateful_refactor_followup: [0.86, 0.94],
    rename_then_answer: [0.87, 0.95],
    bugfix_then_test: [0.86, 0.94],
  }[task.id];
  return [
    {
      name: "Pi",
      estimatedInputTokens: toRange(result.totalInputTokens, piInputRange[0], piInputRange[1]),
      estimatedTotalTokens: toRange(totalTokens, piInputRange[0], piInputRange[1]),
      note: task.id === "repo_exploration"
        ? "Pi likely wins more on exploration because its docs emphasize a smaller base prompt and on-demand skills."
        : task.id === "stateful_refactor_followup" || task.id === "rename_then_answer" || task.id === "bugfix_then_test"
          ? "Pi may lose ground on multi-turn continuity if it relies more on compact prompts than explicit carried repo state."
        : "Pi likely lands near parity here; its prompt minimalism helps, but this repo now avoids replaying transient file context.",
      sources: [...COMPARATOR_SOURCES.pi],
    },
    {
      name: "OpenCode",
      estimatedInputTokens: toRange(result.totalInputTokens, opencodeInputRange[0], opencodeInputRange[1]),
      estimatedTotalTokens: toRange(totalTokens, opencodeInputRange[0], opencodeInputRange[1]),
      note: task.id === "multi_file_refactor" || task.id === "bug_fix"
        ? "OpenCode likely still spends less on longer edit flows because its docs expose stronger pruning, cache-key, and small-model controls."
        : task.id === "stateful_refactor_followup" || task.id === "rename_then_answer" || task.id === "bugfix_then_test"
          ? "OpenCode likely still has an edge on stateful follow-ups because its pruning and agent/tool surfaces are more explicit on long flows."
        : "OpenCode likely keeps a modest edge from its explicit compaction/prune and small-model configuration surfaces.",
      sources: [...COMPARATOR_SOURCES.opencode],
    },
  ];
}

async function resolveBenchmarkModel(provider?: string, model?: string): Promise<{
  providerId: string;
  modelId: string;
  providerRegistry: ProviderRegistry;
  activeModel: Awaited<ReturnType<typeof resolveOneShotModel>>["activeModel"];
  providers: DetectedProvider[];
}> {
  const providerRegistry = new ProviderRegistry();
  const providers = await detectProviders();
  if (providers.length === 0 && !provider) {
    throw new Error("No configured providers detected. Pass --provider/--model or configure a local/hosted provider first.");
  }
  const resolved = await resolveOneShotModel({
    opts: { provider, model },
    providers,
    providerRegistry,
  });
  return {
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    providerRegistry,
    activeModel: resolved.activeModel,
    providers,
  };
}

function buildToolFactory() {
  return (allowedTools: readonly ToolName[]) => getTools({ include: allowedTools }) as Record<string, unknown>;
}

function snapshotUsage(session: Session): BenchmarkRunUsage {
  return {
    inputTokens: session.getTotalInputTokens(),
    outputTokens: session.getTotalOutputTokens(),
    cost: session.getTotalCost(),
  };
}

function getTaskSteps(task: FixedBenchmarkTask) {
  if (task.steps && task.steps.length > 0) return task.steps;
  if (task.prompt && task.retryPrompt && task.verify) {
    return [{ prompt: task.prompt, retryPrompt: task.retryPrompt, verify: task.verify }];
  }
  throw new Error(`Benchmark task ${task.id} is missing prompt/verify steps.`);
}

export async function runFixedBenchmarkSuite(options: FixedBenchmarkOptions = {}): Promise<BenchmarkSuiteResult> {
  const suiteName = options.suiteName ?? "fixed";
  const taskSource = suiteName === "extended" ? getExtendedBenchmarkTasks() : getFixedBenchmarkTasks();
  const tasks = taskSource.filter((task) => !options.taskIds || options.taskIds.includes(task.id));
  const { providerId, modelId, providerRegistry, activeModel } = await resolveBenchmarkModel(options.provider, options.model);
  const { smallModel, smallModelId } = rebuildSmallModelState(providerRegistry, activeModel, modelId);
  const mode = options.mode ?? "build";
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const startedAt = new Date().toISOString();
  const taskResults: BenchmarkTaskResult[] = [];

  for (const task of tasks) {
    const workspace = await mkdtemp(join(tmpdir(), `brokecli-bench-${task.id}-`));
    try {
      await writeFixtureFiles(workspace, task.files);
      const initialSnapshot = new Map(Object.entries(task.files));
      const sessionModule = await import("../core/session.js");
      const { Session } = sessionModule;
      const session = new Session(`benchmark-${task.id}-${Date.now()}`);
      session.setProviderModel(activeModel.provider.name, modelId);
      const app = new BenchmarkTurnApp();
      const turns: BenchmarkTurnResult[] = [];
      let lastToolCalls: string[] = [];
      let lastActivityTime = Date.now();
      let previousUsage = snapshotUsage(session);
      const suiteStarted = Date.now();
      let finalVerification: TaskVerification = { success: false, message: "not run" };
      let turnNumber = 0;
      const steps = getTaskSteps(task);

      for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
        const step = steps[stepIndex]!;
        const stepSnapshot = await collectWorkspaceSnapshot(workspace);
        let prompt = step.prompt;
        let stepVerification: TaskVerification = { success: false, message: "not run" };
        for (let attempt = 1; attempt <= maxTurns; attempt++) {
          turnNumber += 1;
          const turnStarted = Date.now();
          const previousCwd = process.cwd();
          process.chdir(workspace);
          try {
            const policy = await resolveTurnPolicy(
              prompt,
              lastToolCalls,
              session.getRepoState(),
              activeModel.runtime === "sdk" && activeModel.model
                ? { model: activeModel.model, modelId, providerId }
                : null,
            );
            const systemPrompt = buildSystemPrompt(resolve(workspace), providerId, mode, "auto", policy.promptProfile);
            const outcome = await runModelTurn({
              app,
              session,
              text: prompt,
              activeModel,
              currentModelId: modelId,
              smallModel,
              smallModelId,
              currentMode: mode,
              systemPrompt,
              buildTools: buildToolFactory(),
              hooks: { emit: () => {} },
              lastToolCalls,
              lastActivityTime,
            });
            lastToolCalls = outcome.lastToolCalls;
            lastActivityTime = outcome.lastActivityTime;
          } finally {
            process.chdir(previousCwd);
          }

          stepVerification = await step.verify(workspace, app.getLastAssistantContent(), initialSnapshot, stepSnapshot);
          finalVerification = stepVerification;
          const currentUsage = snapshotUsage(session);
          turns.push({
            turn: turnNumber,
            step: stepIndex + 1,
            prompt,
            latencyMs: Date.now() - turnStarted,
            inputTokens: currentUsage.inputTokens - previousUsage.inputTokens,
            outputTokens: currentUsage.outputTokens - previousUsage.outputTokens,
            cost: currentUsage.cost - previousUsage.cost,
            success: stepVerification.success,
            verification: stepVerification.message,
          });
          previousUsage = currentUsage;
          if (stepVerification.success) break;
          prompt = `${step.retryPrompt}\n\nVerifier feedback: ${stepVerification.message}`;
        }
        if (!stepVerification.success) break;
      }

      const totalInputTokens = session.getTotalInputTokens();
      const totalOutputTokens = session.getTotalOutputTokens();
      taskResults.push({
        taskId: task.id,
        category: task.id,
        prompt: task.steps?.[0]?.prompt ?? task.prompt ?? task.description,
        providerId,
        modelId,
        success: finalVerification.success,
        failureReason: finalVerification.success ? undefined : finalVerification.message,
        totalInputTokens,
        totalOutputTokens,
        totalCost: session.getTotalCost(),
        totalTurns: turns.length,
        latencyMs: Date.now() - suiteStarted,
        spend: sumToolOutputTokens(session.getBudgetMetrics()),
        turns,
        comparatorEstimates: buildComparatorEstimates(task, { totalInputTokens, totalOutputTokens }),
      });
    } finally {
      if (!options.keepWorkspaces) await cleanupWorkspace(workspace);
    }
  }

  const summary: BenchmarkSuiteSummary = {
    taskCount: taskResults.length,
    succeeded: taskResults.filter((task) => task.success).length,
    failed: taskResults.filter((task) => !task.success).length,
    averageInputTokens: average(taskResults.map((task) => task.totalInputTokens)),
    averageOutputTokens: average(taskResults.map((task) => task.totalOutputTokens)),
    averageTotalTokens: average(taskResults.map((task) => task.totalInputTokens + task.totalOutputTokens)),
    averageLatencyMs: average(taskResults.map((task) => task.latencyMs)),
    totalCost: taskResults.reduce((sum, task) => sum + task.totalCost, 0),
  };

  return {
    suiteName,
    providerId,
    modelId,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    tasks: taskResults,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function renderFixedBenchmarkReport(result: BenchmarkSuiteResult): string {
  const lines: string[] = [];
  lines.push(`${result.suiteName === "extended" ? "Extended" : "Fixed"} benchmark suite`);
  lines.push(`provider/model: ${result.providerId}/${result.modelId}`);
  lines.push(`tasks: ${result.summary.taskCount} · success ${result.summary.succeeded}/${result.summary.taskCount} · avg input ${result.summary.averageInputTokens} · avg output ${result.summary.averageOutputTokens} · avg total ${result.summary.averageTotalTokens} · avg latency ${result.summary.averageLatencyMs}ms · total cost ${result.summary.totalCost.toFixed(6)}`);
  for (const task of result.tasks) {
    lines.push("");
    lines.push(`${task.taskId}: ${task.success ? "success" : "failure"} · turns ${task.totalTurns} · input ${task.totalInputTokens} · output ${task.totalOutputTokens} · latency ${task.latencyMs}ms · cost ${task.totalCost.toFixed(6)}`);
    lines.push(`  spend: planner in/out ${task.spend.plannerInputTokens}/${task.spend.plannerOutputTokens} · executor in/out ${task.spend.executorInputTokens}/${task.spend.executorOutputTokens} · tool output ${task.spend.toolOutputTokens}`);
    lines.push(`  input mix: system ${task.spend.systemPromptTokens} · replay ${task.spend.replayInputTokens} · state ${task.spend.stateCarrierTokens} · transient ${task.spend.transientContextTokens}`);
    lines.push(`  output mix: visible ${task.spend.visibleOutputTokens} · hidden ${task.spend.hiddenOutputTokens}`);
    if (task.spend.topToolOutputs.length > 0) {
      lines.push(`  top tool output: ${task.spend.topToolOutputs.map((entry) => `${entry.tool} ${entry.tokens}`).join(", ")}`);
    }
    if (!task.success && task.failureReason) lines.push(`  failure: ${task.failureReason}`);
    for (const turn of task.turns) {
      lines.push(`  step ${turn.step} turn ${turn.turn}: ${turn.success ? "ok" : "retry"} · input ${turn.inputTokens} · output ${turn.outputTokens} · latency ${turn.latencyMs}ms · ${turn.verification}`);
    }
    for (const estimate of task.comparatorEstimates) {
      lines.push(`  ${estimate.name} estimate: input ${estimate.estimatedInputTokens} · total ${estimate.estimatedTotalTokens} · ${estimate.note}`);
    }
  }
  return lines.join("\n");
}
