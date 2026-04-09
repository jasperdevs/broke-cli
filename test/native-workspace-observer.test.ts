import { describe, expect, it } from "vitest";
import { shouldExposeOpaqueNativeWorkspaceEdits } from "../src/cli/native-workspace-observer.js";

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
});
