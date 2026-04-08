import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRuntimeSettings, setRuntimeSettings } from "../src/core/config.js";
import { readFileDirect } from "../src/tools/file-ops.js";
import { webFetchTool } from "../src/tools/web.js";
import { readFileForContext } from "../src/tui/file-picker.js";

describe("efficiency caps", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    clearRuntimeSettings();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("truncates readFile output at the lower cap", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-read-cap-"));
    tempDirs.push(dir);
    const file = join(dir, "large.txt");
    writeFileSync(file, "x".repeat(7000), "utf-8");
    setRuntimeSettings({ autonomy: { allowReadOutsideWorkspace: true } as any });

    const result = readFileDirect({ path: file });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(6000);
  });

  it("keeps @file injection smaller than normal reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-picker-cap-"));
    tempDirs.push(dir);
    const file = join(dir, "context.txt");
    writeFileSync(file, "y".repeat(5000), "utf-8");

    const content = readFileForContext(dir, "context.txt");

    expect(content).toContain("(truncated, 5000 chars total)");
    expect(content.startsWith("y".repeat(4000))).toBe(true);
  });

  it("truncates fetched web content at the lower cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: { get: () => "text/html" },
      text: async () => `<html><body>${"z".repeat(7000)}</body></html>`,
      arrayBuffer: async () => new TextEncoder().encode(`<html><body>${"z".repeat(7000)}</body></html>`).buffer,
    })));

    const result = await (webFetchTool as any).execute({ url: "https://example.com/docs" });

    expect(result.success).toBe(true);
    expect(result.content.endsWith("[truncated]")).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(6012);
  });
});
