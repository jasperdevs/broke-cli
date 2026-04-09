import { describe, expect, it } from "vitest";
import { updateSetting } from "../src/core/config.js";
import { checkBudget } from "../src/core/budget.js";

describe("budget setting wiring", () => {
  it("uses settings.maxSessionCost for the live session budget gate", () => {
    updateSetting("maxSessionCost", 1);
    expect(checkBudget(0.5).allowed).toBe(true);
    expect(checkBudget(1).allowed).toBe(false);
    updateSetting("maxSessionCost", 0);
  });
});
