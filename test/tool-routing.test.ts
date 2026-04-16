import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { bashTool, createBashTool } from "../src/tools/bash.js";
import { listFilesDirect, semSearchDirect } from "../src/tools/file-ops.js";

describe("tool routing", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reroutes simple shell file reads into readFile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-route-"));
    tempDirs.push(dir);
    const file = join(dir, "README.md");
    writeFileSync(file, "# Hello\nworld\n", "utf-8");

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const result = await (bashTool as any).execute({ command: "cat README.md" });
      expect(result.success).toBe(true);
      expect(result.rerouted).toBe(true);
      expect(result.reroutedTo).toBe("readFile");
      expect(result.output).toContain("# Hello");
    } finally {
      process.chdir(previous);
    }
  });

  it("reroutes simple shell find calls into listFiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-find-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n", "utf-8");
    writeFileSync(join(dir, "b.ts"), "export const b = 2;\n", "utf-8");

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const result = await (bashTool as any).execute({ command: "find . -name '*.ts'" });
      expect(result.success).toBe(true);
      expect(result.rerouted).toBe(true);
      expect(result.reroutedTo).toBe("listFiles");
      expect(result.output).toContain("a.ts");
      expect(result.output).toContain("b.ts");
    } finally {
      process.chdir(previous);
    }
  });

  it("scopes factory-created bash tools to their configured cwd", async () => {
    const scopedDir = mkdtempSync(join(tmpdir(), "brokecli-scoped-tool-"));
    const otherDir = mkdtempSync(join(tmpdir(), "brokecli-other-tool-"));
    tempDirs.push(scopedDir, otherDir);
    writeFileSync(join(scopedDir, "README.md"), "# Scoped\n", "utf-8");
    writeFileSync(join(otherDir, "README.md"), "# Other\n", "utf-8");

    const previous = process.cwd();
    process.chdir(otherDir);
    try {
      const scopedBash = createBashTool(scopedDir);
      const result = await (scopedBash as any).execute({ command: "cat README.md" });
      expect(result.success).toBe(true);
      expect(result.output).toContain("# Scoped");
      expect(result.output).not.toContain("# Other");
    } finally {
      process.chdir(previous);
    }
  });

  it("returns ranked semantic-style matches for natural language queries", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-sem-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "auth.ts"), "export function refreshAuthToken() {\n  return verifySessionToken();\n}\n", "utf-8");
    writeFileSync(join(dir, "sidebar.ts"), "export function renderSidebarFooter() {\n  return 'footer';\n}\n", "utf-8");

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const result = semSearchDirect({ query: "where is auth token refresh handled", path: ".", limit: 3 });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0]?.file).toContain("auth.ts");
      expect(result.results[0]?.excerpt.toLowerCase()).toContain("token");
    } finally {
      process.chdir(previous);
    }
  });

  it("caps native file listings to avoid oversized tool payloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-list-"));
    tempDirs.push(dir);
    for (let i = 0; i < 150; i++) {
      writeFileSync(join(dir, `file-${i}.ts`), `export const value${i} = ${i};\n`, "utf-8");
    }

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const result = listFilesDirect({ path: ".", maxDepth: 1, include: "*.ts" });
      expect(result.files.length).toBeLessThanOrEqual(120);
      expect(result.totalEntries).toBe(120);
      expect(result.truncated).toBe(true);
    } finally {
      process.chdir(previous);
    }
  });
});
