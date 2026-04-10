import { describe, expect, it } from "vitest";
import { getModelCapabilities } from "../src/ai/provider-capabilities.js";

describe("model capability snapshot", () => {
  it("normalizes reasoning and caching behavior into one capability object", () => {
    const anthropic = getModelCapabilities({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      runtime: "sdk",
    });
    expect(anthropic.reasoning.supported).toBe(true);
    expect(anthropic.caching.messageEphemeral).toBe(true);
    expect(anthropic.reasoning.levels).toContain("minimal");

    const codexNative = getModelCapabilities({
      providerId: "codex",
      modelId: "gpt-5.4-mini",
      runtime: "native-cli",
    });
    expect(codexNative.reasoning.levels).toEqual(["off", "low", "medium", "high"]);
    expect(codexNative.caching.promptCacheKey).toBe(true);
  });
});
