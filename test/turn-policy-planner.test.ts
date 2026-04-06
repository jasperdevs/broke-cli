import { existsSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
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

import {
  resolveTurnPolicy,
  resetPlannedScaffoldCacheForTests,
  shouldPreferSmallExecutor,
} from "../src/core/turn-policy.js";

const cacheFile = join(homedir(), ".brokecli", "turn-policy-cache.json");

describe("planned scaffolds", () => {
  beforeEach(() => {
    if (existsSync(cacheFile)) rmSync(cacheFile, { force: true });
    resetPlannedScaffoldCacheForTests();
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

  it("reloads cached scaffolds after an in-process cache reset", async () => {
    const planner = { model: {} as any, modelId: "gpt-5.4-mini", providerId: "openai" };

    const first = await resolveTurnPolicy("review this file tree", [], planner);
    expect(first.scaffoldSource).toBe("planned");
    expect(first.plannerCacheHit).toBe(false);
    expect(existsSync(cacheFile)).toBe(true);

    resetPlannedScaffoldCacheForTests();
    generateTextMock.mockClear();

    const second = await resolveTurnPolicy("review the render path", [], planner);
    expect(second.scaffoldSource).toBe("planned");
    expect(second.plannerCacheHit).toBe(true);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("falls back to built-in scaffolds when planner output is unusable", async () => {
    const planner = { model: {} as any, modelId: "gpt-5.4-mini", providerId: "openai" };
    generateTextMock.mockResolvedValueOnce({
      text: "be concise",
      usage: { inputTokens: 50, outputTokens: 2 },
    });

    const policy = await resolveTurnPolicy("review this code", [], planner);

    expect(policy.scaffoldSource).toBe("builtin");
    expect(policy.plannerCacheHit).toBeUndefined();
    expect(policy.plannerUsage).toBeUndefined();
  });

  it("keeps edits and bugfixes off the forced small-model lane", async () => {
    const planner = { model: {} as any, modelId: "gpt-5.4-mini", providerId: "openai" };

    const question = await resolveTurnPolicy("what file handles the sidebar?", [], planner);
    const bugfix = await resolveTurnPolicy("fix the broken sidebar footer wrap", [], planner);

    expect(shouldPreferSmallExecutor(question, 1, false)).toBe(true);
    expect(shouldPreferSmallExecutor(bugfix, 3, false)).toBe(false);
  });
});
