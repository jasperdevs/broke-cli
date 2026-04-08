import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { clearRuntimeSettings, setRuntimeSettings } from "../src/core/config.js";
import { bashTool } from "../src/tools/bash.js";
import { editFileDirect, writeFileDirect } from "../src/tools/file-ops.js";

describe("autonomy permissions", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    clearRuntimeSettings();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("blocks writes outside the workspace by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-write-"));
    tempDirs.push(dir);

    const result = writeFileDirect({ path: join(dir, "outside.txt"), content: "blocked" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("outside the workspace");
  });

  it("rejects non-unique edit replacements", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-edit-"));
    tempDirs.push(dir);
    const file = join(process.cwd(), "test", `.tmp-permissions-${Date.now()}.txt`);
    writeFileSync(file, "same\nsame\n", "utf-8");

    try {
      const result = editFileDirect({ path: file, old_string: "same", new_string: "diff" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("exactly once");
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("blocks dangerous shell commands by default", async () => {
    const result = await (bashTool as any).execute({ command: "rm -rf /" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("dangerous shell command");
  });

  it("allows explicitly trusted external writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-trusted-write-"));
    tempDirs.push(dir);
    setRuntimeSettings({ autonomy: { additionalWriteRoots: [dir] } as any });

    const result = writeFileDirect({ path: join(dir, "allowed.txt"), content: "ok" });

    expect(result.success).toBe(true);
  });
});
