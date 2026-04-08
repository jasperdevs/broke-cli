import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextOptimizer } from "../src/core/context-optimizer.js";
import { grepDirect, readFileDirect, semSearchDirect, writeFileDirect } from "../src/tools/file-ops.js";
import { setActiveToolContext } from "../src/tools/runtime-context.js";

describe("tool memoization", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    setActiveToolContext(null);
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reuses unchanged file reads across turns unless refresh is requested", () => {
    const dir = mkdtempSync(join(process.cwd(), ".tmp", "brokecli-memo-read-"));
    tempDirs.push(dir);
    const file = join(dir, "note.ts");
    writeFileSync(file, "export const value = 1;\n", "utf-8");

    const optimizer = new ContextOptimizer();
    setActiveToolContext({ contextOptimizer: optimizer, memoizedToolResults: true });

    optimizer.nextTurn();
    const first = readFileDirect({ path: file, mode: "full" });
    expect(first.success).toBe(true);
    expect((first as any).memoized).toBeUndefined();

    optimizer.nextTurn();
    const second = readFileDirect({ path: file, mode: "full" });
    expect(second.success).toBe(true);
    expect((second as any).memoized).toBe(true);
    expect((second as any).content).toContain("memoized reuse");

    const refreshed = readFileDirect({ path: file, mode: "full", refresh: true });
    expect(refreshed.success).toBe(true);
    expect((refreshed as any).memoized).toBeUndefined();
    expect((refreshed as any).content).toContain("export const value");
  });

  it("reuses unchanged grep results across adjacent turns", () => {
    const dir = mkdtempSync(join(process.cwd(), ".tmp", "brokecli-memo-grep-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "auth.ts"), "export function refreshAuthToken() {\n  return 'ok';\n}\n", "utf-8");

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const optimizer = new ContextOptimizer();
      setActiveToolContext({ contextOptimizer: optimizer, memoizedToolResults: true });

      optimizer.nextTurn();
      const first = grepDirect({ pattern: "refreshAuthToken", path: "." });
      expect(first.totalMatches).toBeGreaterThan(0);
      expect((first as any).memoized).toBeUndefined();

      optimizer.nextTurn();
      const second = grepDirect({ pattern: "refreshAuthToken", path: "." });
      expect((second as any).memoized).toBe(true);
      expect(second.totalMatches).toBeGreaterThan(0);
    } finally {
      process.chdir(previous);
    }
  });

  it("reuses unchanged semantic search results across adjacent turns", () => {
    const dir = mkdtempSync(join(process.cwd(), ".tmp", "brokecli-memo-sem-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "auth.ts"), "export function refreshAuthToken() {\n  return 'ok';\n}\n", "utf-8");

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const optimizer = new ContextOptimizer();
      setActiveToolContext({ contextOptimizer: optimizer, memoizedToolResults: true });

      optimizer.nextTurn();
      const first = semSearchDirect({ query: "where is auth token refresh handled", path: ".", limit: 3 });
      expect((first as any).memoized).toBeUndefined();

      optimizer.nextTurn();
      const second = semSearchDirect({ query: "where is auth token refresh handled", path: ".", limit: 3 });
      expect((second as any).memoized).toBe(true);
    } finally {
      process.chdir(previous);
    }
  });

  it("invalidates read memoization after writes", () => {
    const dir = mkdtempSync(join(process.cwd(), ".tmp", "brokecli-memo-write-"));
    tempDirs.push(dir);
    const file = join(dir, "note.ts");
    writeFileSync(file, "export const value = 1;\n", "utf-8");

    const optimizer = new ContextOptimizer();
    setActiveToolContext({ contextOptimizer: optimizer, memoizedToolResults: true });

    optimizer.nextTurn();
    const first = readFileDirect({ path: file, mode: "full" });
    expect(first.success).toBe(true);

    const write = writeFileDirect({ path: file, content: "export const value = 2;\n" });
    expect(write.success).toBe(true);

    optimizer.nextTurn();
    const second = readFileDirect({ path: file, mode: "full" });
    expect((second as any).memoized).toBeUndefined();
    expect((second as any).content).toContain("value = 2");
  });
});
