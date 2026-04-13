import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { getCatalogModelIds, getModelCatalogCachePathForTests, loadModelCatalog, resetModelCatalogForTests } from "../src/ai/model-catalog.js";

describe("model catalog cache", () => {
  const cachePath = getModelCatalogCachePathForTests();
  const originalFetch = global.fetch;
  const previousCache = existsSync(cachePath) ? readFileSync(cachePath, "utf-8") : null;

  afterEach(() => {
    resetModelCatalogForTests();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (previousCache === null) rmSync(cachePath, { force: true });
    else writeFileSync(cachePath, previousCache, "utf-8");
  });

  it("reuses the cached catalog when the remote fetch fails", async () => {
    writeFileSync(cachePath, JSON.stringify({
      cached: {
        id: "cached",
        name: "cached",
        models: {
          "cached-model": {
            id: "cached-model",
            name: "Cached Model",
            limit: {},
            cost: { input: 1, output: 2 },
          },
        },
      },
    }), "utf-8");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    await loadModelCatalog();

    expect(getCatalogModelIds("cached")).toContain("cached-model");
  });
});
