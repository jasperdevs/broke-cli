import { beforeEach, describe, expect, it, vi } from "vitest";

const { execSyncMock, settings } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  settings: { gitCheckpoints: true },
}));

vi.mock("child_process", () => ({
  execSync: execSyncMock,
}));

vi.mock("../src/core/config.js", () => ({
  getSettings: () => settings,
}));

import { createCheckpoint } from "../src/core/git.js";

describe("git checkpoints", () => {
  beforeEach(() => {
    settings.gitCheckpoints = true;
    execSyncMock.mockReset();
  });

  it("skips checkpoint commands when git checkpoints are disabled", () => {
    settings.gitCheckpoints = false;

    expect(createCheckpoint()).toBe(false);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("still creates a checkpoint when enabled and the repo is dirty", () => {
    execSyncMock.mockImplementation((command: string) => {
      if (command === "git rev-parse --is-inside-work-tree") return "true\n";
      if (command === "git status --porcelain") return " M src/app.ts\n";
      if (command === "git add -A") return "";
      if (command.startsWith("git commit -m ")) return "";
      if (command === "git rev-parse HEAD") return "abcdef123456\n";
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(createCheckpoint()).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith("git add -A", { stdio: "pipe" });
    expect(execSyncMock).toHaveBeenCalledWith(
      'git commit -m "checkpoint before tool changes" --no-verify',
      { encoding: "utf-8", stdio: "pipe" },
    );
  });
});
