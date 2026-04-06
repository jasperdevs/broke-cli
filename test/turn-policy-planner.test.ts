import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

import { resolveTurnPolicy, shouldPreferSmallExecutor } from "../src/core/turn-policy.js";

describe("planned scaffolds", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue({
      text: "lane: cheap\ngoal: inspect\nsteps: 1) read 2) answer\ntools: readFile, grep\nrules: no edits\nverify: cite evidence",
      usage: { inputTokens: 120, outputTokens: 32 },
    });
  });

  it("plans once and then reuses the scaffold cache", async () => {
    const planner = { model: {} as any, modelId: "gpt-5.4-mini", providerId: "openai" };

    const first = await resolveTurnPolicy("read src/app.ts and tell me what it does", [], planner);
    const second = await resolveTurnPolicy("show me how the sidebar render works", [], planner);

    expect(first.scaffoldSource).toBe("planned");
    expect(first.plannerCacheHit).toBe(false);
    expect(first.plannerUsage?.inputTokens).toBe(120);
    expect(second.scaffoldSource).toBe("planned");
    expect(second.plannerCacheHit).toBe(true);
    expect(second.plannerUsage).toBeUndefined();
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("keeps edits and bugfixes off the forced small-model lane", async () => {
    const planner = { model: {} as any, modelId: "gpt-5.4-mini", providerId: "openai" };

    const question = await resolveTurnPolicy("what file handles the sidebar?", [], planner);
    const bugfix = await resolveTurnPolicy("fix the broken sidebar footer wrap", [], planner);

    expect(shouldPreferSmallExecutor(question, 1, false)).toBe(true);
    expect(shouldPreferSmallExecutor(bugfix, 3, false)).toBe(false);
  });
});
