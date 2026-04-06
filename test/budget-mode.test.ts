import { describe, expect, it } from "vitest";
import { getTurnPolicy } from "../src/core/turn-policy.js";
import { Session } from "../src/core/session.js";
import { buildBudgetReport, summarizeBudgetMetrics } from "../src/core/budget-insights.js";

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

  it("formats a useful budget report and summary", () => {
    const session = new Session(`test-insights-${Date.now()}`);
    session.recordTurn({ smallModel: true, toolsExposed: 6, toolsUsed: 2, plannerCacheHit: true });
    session.recordIdleCacheCliff();
    session.recordCompaction({ freshThreadCarryForward: true });

    const report = buildBudgetReport(session);
    const summary = summarizeBudgetMetrics(session.getBudgetMetrics());

    expect(report).toContain("Small-model turns: 1");
    expect(report).toContain("Exposed but unused: 4");
    expect(report).toContain("Fresh carry-forwards: 1");
    expect(summary).toContain("cliffs 1");
    expect(summary).toContain("tool waste 4");
  });
});
