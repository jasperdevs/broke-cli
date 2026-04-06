import { describe, expect, it } from "vitest";
import { filterCommandOutput, rewriteCommand } from "../src/tools/command-filter.js";
import { getCommandMatches } from "../src/tui/command-surface.js";

describe("command-aware filtering", () => {
  it("rewrites simple git status to a compact form", () => {
    expect(rewriteCommand("git status")).toBe("git status --short --branch");
  });

  it("groups grep-style results by file", () => {
    const result = filterCommandOutput(
      "rg token src",
      "src/a.ts:10:const token = 1\nsrc/a.ts:12:return token\nsrc/b.ts:8:tokenCount++",
      "",
      0,
    );

    expect(result.output).toContain("src/a.ts (2)");
    expect(result.output).toContain("src/b.ts (1)");
  });

  it("hides /agents from slash suggestions when there are no agent runs", () => {
    expect(getCommandMatches("/", { hasAgentRuns: false }).some((entry) => entry.name === "agents")).toBe(false);
    expect(getCommandMatches("/", { hasAgentRuns: true }).some((entry) => entry.name === "agents")).toBe(true);
  });
});
