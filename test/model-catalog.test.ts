import { describe, expect, it } from "vitest";
import { calculateCost, getContextLimit } from "../src/ai/cost.js";

describe("models.dev-backed pricing fallback", () => {
  it("calculates cost for known fallback models", () => {
    const usage = calculateCost("gpt-4o-mini", 1_000_000, 1_000_000, "openai");
    expect(usage.cost).toBeCloseTo(0.75, 5);
    expect(usage.totalTokens).toBe(2_000_000);
  });

  it("exposes a context limit for known models", () => {
    expect(getContextLimit("claude-sonnet-4-6", "anthropic")).toBeGreaterThan(100_000);
  });
});
