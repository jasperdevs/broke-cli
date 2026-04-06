import { describe, expect, it } from "vitest";
import { filterCommandOutput, rewriteCommand } from "../src/tools/command-filter.js";

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
});
