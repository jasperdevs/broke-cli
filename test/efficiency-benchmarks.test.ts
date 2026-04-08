import { describe, expect, it } from "vitest";
import { EFFICIENCY_BENCHMARK_CASES, runEfficiencyBenchmarks } from "../src/core/efficiency-benchmarks.js";

describe("efficiency benchmarks", () => {
  it("keeps the deterministic efficiency corpus passing", () => {
    const result = runEfficiencyBenchmarks();

    expect(result.failures).toEqual([]);
    expect(result.totalCases).toBe(EFFICIENCY_BENCHMARK_CASES.length);
    expect(result.routeHits).toBe(EFFICIENCY_BENCHMARK_CASES.length);
    expect(result.policyHits).toBe(EFFICIENCY_BENCHMARK_CASES.length);
    expect(result.cavemanHits).toBe(2);
  });
});
