import { describe, expect, it } from "vitest";
import { resolveNpmCommand } from "../src/core/package-manager.js";

describe("package manager command resolution", () => {
  it("keeps a configured npm command unchanged", () => {
    expect(resolveNpmCommand(["pnpm"], { platform: "win32" })).toEqual(["pnpm"]);
  });

  it("uses the npm CLI bundled with node on Windows", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const npmCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

    expect(resolveNpmCommand([], { platform: "win32", execPath, exists: (path) => path === npmCli })).toEqual([
      execPath,
      npmCli,
    ]);
  });

  it("falls back to npm.cmd on Windows when the bundled npm CLI is unavailable", () => {
    expect(resolveNpmCommand([], { platform: "win32", execPath: "C:\\node\\node.exe", exists: () => false })).toEqual([
      "npm.cmd",
    ]);
  });

  it("uses npm directly outside Windows", () => {
    expect(resolveNpmCommand([], { platform: "linux" })).toEqual(["npm"]);
  });
});
