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

  it("surfaces /tree in slash suggestions", () => {
    expect(getCommandMatches("/").some((entry) => entry.name === "tree")).toBe(true);
  });

  it("keeps the command browser aligned with shipped session/template actions", () => {
    const names = getCommandMatches("/").map((entry) => entry.name);
    expect(names).toContain("fork");
    expect(names).toContain("mode");
    expect(names).toContain("templates");
  });

  it("hides context-sensitive commands when they are not usable", () => {
    const names = getCommandMatches("/", {
      hasMessages: false,
      hasAssistantContent: false,
      canResume: false,
      hasStoredAuth: false,
    }).map((entry) => entry.name);
    expect(names).not.toContain("copy");
    expect(names).not.toContain("logout");
    expect(names).not.toContain("resume");
    expect(names).not.toContain("fork");
  });
});
