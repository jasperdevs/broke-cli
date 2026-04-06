import { describe, expect, it } from "vitest";
import { resolveCavemanLevel } from "../src/core/context.js";

describe("task-aware caveman compression", () => {
  it("disables strong caveman modes for risky debugging tasks", () => {
    expect(resolveCavemanLevel("ultra", "debug why auth token refresh does not work")).toBe("off");
    expect(resolveCavemanLevel("full", "investigate memory leak and performance regression")).toBe("off");
  });

  it("keeps strong caveman modes for safe low-risk edits", () => {
    expect(resolveCavemanLevel("ultra", "update README typo and docs")).toBe("ultra");
    expect(resolveCavemanLevel("full", "add config env var docs")).toBe("full");
  });

  it("downgrades medium-risk feature work to lite compression", () => {
    expect(resolveCavemanLevel("ultra", "implement small config flag")).toBe("lite");
    expect(resolveCavemanLevel("full", "refactor command stage registration")).toBe("lite");
  });
});
