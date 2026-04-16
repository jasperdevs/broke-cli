import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { bashTool, createBashTool } from "../src/tools/bash.js";
import { listFilesDirect, readFileDirect, semSearchDirect } from "../src/tools/file-ops.js";
import { createListFilesTool, createReadFileTool, createWriteFileTool } from "../src/tools/file-ops-tools.js";

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

  it("supports pi-style bash operations and spawn hooks", async () => {
    const calls: Array<{ command: string; cwd: string; env?: NodeJS.ProcessEnv }> = [];
    const scopedBash = createBashTool("/workspace", {
      commandPrefix: "setup",
      spawnHook: (context) => ({ ...context, command: `${context.command}\necho hooked`, cwd: "/sandbox", env: { ...context.env, BROKECLI_TEST: "1" } }),
      operations: {
        exec: async (command, cwd, { onData, env }) => {
          calls.push({ command, cwd, env });
          onData(Buffer.from("operation output\n"));
          return { exitCode: 0 };
        },
      },
    });

    const result = await (scopedBash as any).execute({ command: "echo run" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("operation output");
    expect(calls[0]?.command).toContain("setup");
    expect(calls[0]?.command).toContain("echo hooked");
    expect(calls[0]?.cwd).toBe("/sandbox");
    expect(calls[0]?.env?.BROKECLI_TEST).toBe("1");
  });

  it("supports pi-style custom file operations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-file-ops-"));
    tempDirs.push(dir);
    const files = new Map<string, string>([[join(dir, "note.txt"), "hello from ops"]]);
    const operations = {
      readFile: (path: string) => Buffer.from(files.get(path) ?? ""),
      stat: (path: string) => ({ isDirectory: () => path === dir, size: files.get(path)?.length ?? 0, mtimeMs: 1 }),
      readdir: () => ["note.txt", "out.txt"],
      mkdir: () => {},
      writeFile: (path: string, content: string) => files.set(path, content),
    };

    const readResult = await (createReadFileTool(dir, { operations }) as any).execute({ path: "note.txt" });
    const writeResult = await (createWriteFileTool(dir, { operations }) as any).execute({ path: "out.txt", content: "written by ops" });
    const listResult = await (createListFilesTool(dir, { operations }) as any).execute({ path: "." });

    expect(readResult.content).toContain("hello from ops");
    expect(writeResult.success).toBe(true);
    expect(files.get(join(dir, "out.txt"))).toBe("written by ops");
    expect(listResult.files).toEqual(expect.arrayContaining(["note.txt", "out.txt"]));
  });

  it("normalizes at-prefixed paths against the scoped cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-path-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "README.md"), "# Scoped path\n", "utf-8");

    const result = readFileDirect({ path: "@README.md", cwd: dir });

    expect(result.success).toBe(true);
    expect(result.content).toContain("# Scoped path");
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
