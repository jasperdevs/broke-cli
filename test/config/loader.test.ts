import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/loader.js";

describe("config loader", () => {
  it("returns valid default config when no files exist", async () => {
    const config = await loadConfig("/nonexistent/path");

    expect(config.routing.strategy).toBe("manual");
    expect(config.budget.warningThreshold).toBe(0.8);
    expect(config.context.reduceVerbosity).toBe(true);
    expect(config.context.preferDiffs).toBe(true);
    expect(config.cache.enabled).toBe(true);
    expect(config.ui.theme).toBe("dark");
    expect(config.ui.showCostTicker).toBe(true);
    expect(config.permissions.allow).toEqual([]);
  });

  it("merges CLI overrides into config", async () => {
    const config = await loadConfig("/nonexistent/path", {
      routing: { strategy: "broke" },
      budget: { daily: 1.5 },
    });

    expect(config.routing.strategy).toBe("broke");
    expect(config.budget.daily).toBe(1.5);
    // Defaults still present
    expect(config.context.reduceVerbosity).toBe(true);
  });
});
