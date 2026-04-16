import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { captureNativeWorkspaceBaseline, recordNativeWorkspaceDelta, shouldExposeOpaqueNativeWorkspaceEdits } from "../src/cli/native-workspace-observer.js";
import { Session } from "../src/core/session.js";

describe("native workspace observer", () => {
  it("does not expose dirty workspace deltas as native actions for casual turns", () => {
    expect(shouldExposeOpaqueNativeWorkspaceEdits({
      archetype: "casual",
      allowedTools: [],
    })).toBe(false);
  });

  it("exposes opaque native file edits only for write-capable edit turns", () => {
    expect(shouldExposeOpaqueNativeWorkspaceEdits({
      archetype: "edit",
      allowedTools: ["readFile"],
    })).toBe(false);
    expect(shouldExposeOpaqueNativeWorkspaceEdits({
      archetype: "edit",
      allowedTools: ["readFile", "editFile"],
    })).toBe(true);
    expect(shouldExposeOpaqueNativeWorkspaceEdits({
      archetype: "bugfix",
      allowedTools: ["writeFile"],
    })).toBe(true);
  });

  it("does not scan non-git directories for opaque native edits", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-native-nongit-"));
    try {
      writeFileSync(join(dir, "loose.txt"), "changed\n", "utf-8");
      expect(captureNativeWorkspaceBaseline(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records only new git status entries after the native run", () => {
    const dir = mkdtempSync(join(tmpdir(), "brokecli-native-git-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "before.txt"), "already dirty\n", "utf-8");
      const baseline = captureNativeWorkspaceBaseline(dir);
      writeFileSync(join(dir, "after.txt"), "new dirty\n", "utf-8");

      expect(recordNativeWorkspaceDelta(new Session(), baseline)).toEqual(["after.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
