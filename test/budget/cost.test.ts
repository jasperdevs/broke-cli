import { describe, it, expect } from "vitest";
import { calculateCost, buildUsage, formatCost, formatTokens } from "../../src/budget/cost.js";

describe("calculateCost", () => {
  const pricing = {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  };

  it("calculates cost without cache", () => {
    const cost = calculateCost(pricing, 1000, 500);
    // input: 1000/1M * 3 = 0.003
    // output: 500/1M * 15 = 0.0075
    expect(cost).toBeCloseTo(0.0105, 5);
  });

  it("calculates cost with cached tokens", () => {
    const cost = calculateCost(pricing, 1000, 500, 800);
    // uncached input: 200/1M * 3 = 0.0006
    // cached: 800/1M * 0.3 = 0.00024
    // output: 500/1M * 15 = 0.0075
    expect(cost).toBeCloseTo(0.00834, 5);
  });

  it("returns 0 for zero tokens", () => {
    expect(calculateCost(pricing, 0, 0)).toBe(0);
  });
});

describe("buildUsage", () => {
  it("builds a complete usage object", () => {
    const pricing = { inputPerMTok: 3, outputPerMTok: 15 };
    const usage = buildUsage(pricing, 1000, 500);
    expect(usage.inputTokens).toBe(1000);
    expect(usage.outputTokens).toBe(500);
    expect(usage.totalTokens).toBe(1500);
    expect(usage.cost).toBeGreaterThan(0);
  });
});

describe("formatCost", () => {
  it("formats tiny costs with 4 decimals", () => {
    expect(formatCost(0.0012)).toBe("$0.0012");
  });

  it("formats small costs with 3 decimals", () => {
    expect(formatCost(0.123)).toBe("$0.123");
  });

  it("formats larger costs with 2 decimals", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });
});

describe("formatTokens", () => {
  it("formats small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500");
  });

  it("formats thousands with K", () => {
    expect(formatTokens(1500)).toBe("1.5K");
  });

  it("formats millions with M", () => {
    expect(formatTokens(1500000)).toBe("1.5M");
  });
});
