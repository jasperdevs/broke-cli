import { describe, expect, it } from "vitest";
import { getExtendedBenchmarkTasks, getFixedBenchmarkTasks, renderFixedBenchmarkReport, type BenchmarkSuiteResult } from "../src/benchmarks/fixed-suite.js";

describe("fixed benchmark suite", () => {
  it("ships the expected benchmark categories", () => {
    const tasks = getFixedBenchmarkTasks();
    expect(tasks.map((task) => task.id)).toEqual([
      "read_modify",
      "multi_file_refactor",
      "bug_fix",
      "test_writing",
      "repo_exploration",
    ]);
  });

  it("ships deeper stateful benchmark categories", () => {
    const tasks = getExtendedBenchmarkTasks();
    expect(tasks.map((task) => task.id)).toEqual([
      "stateful_refactor_followup",
      "rename_then_answer",
      "bugfix_then_test",
    ]);
  });

  it("renders task results with spend and comparator estimates", () => {
    const report = renderFixedBenchmarkReport({
      suiteName: "fixed",
      providerId: "codex",
      modelId: "gpt-5.4-mini",
      startedAt: "2026-04-08T00:00:00.000Z",
      finishedAt: "2026-04-08T00:01:00.000Z",
      summary: {
        taskCount: 1,
        succeeded: 1,
        failed: 0,
        averageInputTokens: 120,
        averageOutputTokens: 40,
        averageTotalTokens: 160,
        averageVisibleOutputTokens: 28,
        averageHiddenOutputTokens: 12,
        averageLatencyMs: 1000,
        totalCost: 0.12,
        costPerSuccess: 0.12,
        averageLatencyPerSuccessMs: 1000,
      },
      tasks: [
        {
          taskId: "read_modify",
          category: "read_modify",
          prompt: "Update a file",
          providerId: "codex",
          modelId: "gpt-5.4-mini",
          success: true,
          totalInputTokens: 120,
          totalOutputTokens: 40,
          totalCost: 0.12,
          totalTurns: 1,
          latencyMs: 1000,
          spend: {
            plannerInputTokens: 20,
            plannerOutputTokens: 5,
            executorInputTokens: 100,
            executorOutputTokens: 35,
            systemPromptTokens: 30,
            replayInputTokens: 20,
            stateCarrierTokens: 10,
            transientContextTokens: 0,
            visibleOutputTokens: 28,
            hiddenOutputTokens: 12,
            toolOutputTokens: 12,
            topToolOutputs: [{ tool: "readFile", tokens: 12 }],
          },
          turns: [
            {
              turn: 1,
              step: 1,
              prompt: "Update a file",
              latencyMs: 1000,
              inputTokens: 120,
              outputTokens: 40,
              cost: 0.12,
              success: true,
              verification: "ok",
            },
          ],
          comparatorEstimates: [
            {
              name: "Pi",
              estimatedInputTokens: "114-121",
              estimatedTotalTokens: "152-161",
              note: "near parity",
              sources: ["https://pi.dev/"],
            },
            {
              name: "OpenCode",
              estimatedInputTokens: "110-118",
              estimatedTotalTokens: "147-157",
              note: "modest edge",
              sources: ["https://opencode.ai/docs/config/"],
            },
          ],
        },
      ],
    } satisfies BenchmarkSuiteResult);

    expect(report).toContain("provider/model: codex/gpt-5.4-mini");
    expect(report).toContain("read_modify: success");
    expect(report).toContain("planner in/out 20/5");
    expect(report).toContain("input mix: system 30");
    expect(report).toContain("output mix: visible 28");
    expect(report).toContain("avg hidden 12");
    expect(report).toContain("cost/success 0.120000");
    expect(report).toContain("OpenCode estimate: input 110-118");
  });
});
