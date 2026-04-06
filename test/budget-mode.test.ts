import { describe, expect, it } from "vitest";
import { getTurnPolicy } from "../src/core/turn-policy.js";
import { Session } from "../src/core/session.js";
import { buildBudgetReport, renderBudgetDashboard, summarizeBudgetMetrics } from "../src/core/budget-insights.js";

describe("turn policy", () => {
  it("keeps exploration turns on a read-only tool subset with a low step cap", () => {
    const policy = getTurnPolicy("read src/app.ts and tell me what it does");
    expect(policy.archetype).toBe("explore");
    expect(policy.allowedTools).toContain("readFile");
    expect(policy.allowedTools).not.toContain("writeFile");
    expect(policy.maxToolSteps).toBeLessThanOrEqual(2);
  });

  it("keeps edit turns on the broader edit-capable tool set", () => {
    const policy = getTurnPolicy("make index.html and fix the build");
    expect(policy.archetype === "edit" || policy.archetype === "bugfix").toBe(true);
    expect(policy.allowedTools).toContain("editFile");
    expect(policy.allowedTools).toContain("writeFile");
    expect(policy.maxToolSteps).toBeGreaterThanOrEqual(6);
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

  it("formats a structured budget report and summary", () => {
    const session = new Session(`test-insights-${Date.now()}`);
    session.addUsage(200, 40, 0.001);
    session.recordTurn({ smallModel: true, toolsExposed: 6, toolsUsed: 2, plannerCacheHit: true });
    session.recordIdleCacheCliff();
    session.recordCompaction({ freshThreadCarryForward: true });

    const report = buildBudgetReport(session);
    const dashboard = renderBudgetDashboard({ report, width: 110, contextTokens: 88, contextLimit: 128_000 }).join("\n");
    const summary = summarizeBudgetMetrics(session.getBudgetMetrics());

    expect(report.totalTokens).toBe(240);
    expect(report.toolExposureWaste).toBe(4);
    expect(report.freshThreadCarryForwards).toBe(1);
    expect(dashboard).toContain("Session");
    expect(dashboard).toContain("Bleed");
    expect(dashboard).toContain("ctx 88/128k");
    expect(summary).toContain("cliffs 1");
    expect(summary).toContain("tool waste 4");
  });
});
