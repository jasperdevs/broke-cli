import { afterEach, describe, expect, it } from "vitest";
import { updateSetting } from "../src/core/config.js";
import { runValidationSuite } from "../src/cli/auto-validate.js";

describe("auto validation", () => {
  afterEach(() => {
    updateSetting("autoLint", false);
    updateSetting("autoTest", false);
    updateSetting("lintCommand", "npm run lint");
    updateSetting("testCommand", "npm test");
  });

  it("runs configured validation commands after edits", () => {
    updateSetting("autoLint", true);
    updateSetting("lintCommand", process.platform === "win32" ? "cmd /c exit 0" : "true");

    const result = runValidationSuite(true);

    expect(result.attempted).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.report).toContain("lint: ok");
  });
});
