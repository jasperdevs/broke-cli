import { describe, expect, it } from "vitest";
import { getTurnPolicy } from "../src/core/turn-policy.js";
import { Session } from "../src/core/session.js";
import { buildAggregateBudgetReport, buildBudgetReport, renderBudgetDashboard, summarizeBudgetMetrics } from "../src/core/budget-insights.js";

describe("turn policy", () => {
  it("routes casual greetings onto a no-tool lightweight policy", () => {
    const policy = getTurnPolicy("hey");
    expect(policy.archetype).toBe("casual");
    expect(policy.allowedTools).toEqual([]);
    expect(policy.promptProfile).toBe("casual");
    expect(policy.historyWindow).toBe(2);
    expect(policy.maxToolSteps).toBe(0);
  });

  it("keeps exploration turns on a read-only tool subset with a low step cap", () => {
    const policy = getTurnPolicy("read src/app.ts and tell me what it does");
    expect(policy.allowedTools).toContain("readFile");
    expect(policy.allowedTools).toHaveLength(1);
    expect(policy.allowedTools).not.toContain("writeFile");
    expect(policy.allowedTools).not.toContain("agent");
    expect(policy.allowedTools).not.toContain("todoWrite");
    expect(policy.maxToolSteps).toBeLessThanOrEqual(2);
    expect(policy.promptProfile).toBe("lean");
  });

  it("keeps edit turns on the broader edit-capable tool set", () => {
    const policy = getTurnPolicy("make index.html and fix the build");
    expect(policy.archetype === "edit" || policy.archetype === "bugfix").toBe(true);
    expect(policy.allowedTools).toContain("editFile");
    expect(policy.allowedTools).toContain("writeFile");
    expect(policy.maxToolSteps).toBeGreaterThanOrEqual(6);
    expect(policy.promptProfile).toBe("edit");
  });

  it("drops writeFile for existing-file edit requests to enforce patch-first behavior", () => {
    const policy = getTurnPolicy("update README.md to explain the new budget report");
    expect(policy.allowedTools).toContain("editFile");
    expect(policy.allowedTools).not.toContain("writeFile");
  });
});

describe("session budget metrics", () => {
  it("preserves lifetime usage when replacing conversation during compaction", () => {
    const session = new Session(`test-replace-${Date.now()}`);
    session.addMessage("user", "first");
    session.addUsage(200, 40, 0.001);
    session.recordTurn({ smallModel: true, toolsExposed: 4, toolsUsed: 1, plannerCacheHit: false });

    session.replaceConversation([{ role: "assistant", content: "summary" }]);

    expect(session.getTotalInputTokens()).toBe(200);
    expect(session.getTotalOutputTokens()).toBe(40);
    expect(session.getMessages()).toHaveLength(1);
    expect(session.getMessages()[0].content).toBe("summary");
    expect(session.getBudgetMetrics().totalTurns).toBe(1);
  });

  it("keeps compaction summaries hidden from the visible transcript but present in chat context", () => {
    const session = new Session(`test-compaction-summary-${Date.now()}`);
    session.addMessage("user", "first");
    session.addMessage("assistant", "second");
    session.applyCompaction("task: keep going", [{ role: "assistant", content: "latest visible" }], 123);

    expect(session.getMessages().map((msg) => msg.content)).toEqual(["latest visible"]);
    expect(session.getChatMessages()[0]?.content).toContain("<summary>");
    expect(session.getChatMessages()[0]?.content).toContain("task: keep going");
    expect(session.getCompactionSummary()?.tokensBefore).toBe(123);
  });

  it("formats a structured budget report and summary", () => {
    const session = new Session(`test-insights-${Date.now()}`);
    session.addUsage(200, 40, 0.001);
    session.recordTurn({ smallModel: true, toolsExposed: 6, toolsUsed: 2, plannerCacheHit: true });
    session.recordShellRecovery();
    session.recordToolResult("readFile", 120);
    session.recordToolResult("grep", 45);
    session.recordIdleCacheCliff();
    session.recordCompaction({ freshThreadCarryForward: true });
    session.recordTurn({ plannerInputTokens: 120, plannerOutputTokens: 30, executorInputTokens: 200, executorOutputTokens: 40 });

    const report = buildBudgetReport(session);
    const dashboard = renderBudgetDashboard({ report, width: 110, scopeLabel: "current session", contextTokens: 88, contextLimit: 128_000, showContext: true }).join("\n");
    const summary = summarizeBudgetMetrics(session.getBudgetMetrics());

    expect(report.totalTokens).toBe(240);
    expect(report.plannerTokens).toBe(150);
    expect(report.executorTokens).toBe(240);
    expect(report.sessionCount).toBe(1);
    expect(report.toolExposureWaste).toBe(4);
    expect(report.shellRecoveries).toBe(1);
    expect(report.freshThreadCarryForwards).toBe(1);
    expect(report.topToolBleeds[0]).toEqual({ tool: "readFile", tokens: 120, calls: 1 });
    expect(dashboard).toContain("USAGE");
    expect(dashboard).toContain("WORK SPLIT");
    expect(dashboard).toContain("planner");
    expect(dashboard).toContain("executor");
    expect(dashboard).toContain("scope");
    expect(dashboard).toContain("current session");
    const routingDashboard = renderBudgetDashboard({ report, width: 110, scopeLabel: "current session", contextTokens: 88, contextLimit: 128_000, showContext: true, section: "routing" }).join("\n");
    const contextDashboard = renderBudgetDashboard({ report, width: 110, scopeLabel: "current session", contextTokens: 88, contextLimit: 128_000, showContext: true, section: "context" }).join("\n");
    expect(routingDashboard).toContain("HOT TOOLS");
    expect(routingDashboard).toContain("readFile");
    expect(contextDashboard).toContain("CONTEXT");
    expect(contextDashboard).toContain("88");
    expect(summary).toContain("cliffs 1");
    expect(summary).toContain("tool waste 4");
    expect(summary).toContain("shell saves 1");
    expect(summary).toContain("planner 150");
    expect(summary).toContain("hot readFile 120");
  });

  it("aggregates budget metrics across sessions", () => {
    const first = new Session(`test-budget-agg-a-${Date.now()}`);
    first.addUsage(100, 20, 0);
    first.recordTurn({ smallModel: true, toolsExposed: 3, toolsUsed: 1, plannerCacheHit: true });

    const second = new Session(`test-budget-agg-b-${Date.now()}`);
    second.addUsage(50, 10, 0);
    second.recordTurn({ smallModel: false, toolsExposed: 2, toolsUsed: 2, plannerCacheHit: false });
    second.recordIdleCacheCliff();

    const report = buildAggregateBudgetReport([first, second]);

    expect(report.sessionCount).toBe(2);
    expect(report.totalTokens).toBe(180);
    expect(report.inputTokens).toBe(150);
    expect(report.outputTokens).toBe(30);
    expect(report.totalTurns).toBe(2);
    expect(report.idleCacheCliffs).toBe(1);
    expect(report.toolsExposed).toBe(5);
    expect(report.toolsUsed).toBe(3);
  });
});
