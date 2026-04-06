import { describe, expect, it } from "vitest";
import { buildRepoMap, formatRepoMap } from "../src/core/repo-map.js";

describe("repo map", () => {
  it("builds a focused symbol map for the repo", () => {
    const entries = buildRepoMap({ root: process.cwd(), query: "session", maxFiles: 12, maxLinesPerFile: 4 });
    const text = formatRepoMap(entries);

    expect(entries.length).toBeGreaterThan(0);
    expect(text).toContain("##");
    expect(text.toLowerCase()).toContain("session");
  });
});
