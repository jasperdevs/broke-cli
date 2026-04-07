import { describe, expect, it, vi } from "vitest";
import { filterModelIdsForDisplay, resolveVisibleProviderModelId, supportsProviderModel, syncCloudProviderModelsFromCatalog } from "../src/ai/providers.js";
import { ProviderRegistry } from "../src/ai/provider-registry.js";
import { buildVisibleRuntimeModelOptions } from "../src/cli/runtime-models.js";
import * as config from "../src/core/config.js";

describe("provider model filtering", () => {
  it("removes image and embedding models while preserving useful coding/chat models", () => {
    const visible = filterModelIdsForDisplay("openai", [
      "text-embedding-3-large",
      "gpt-image-1",
      "gpt-4o",
      "gpt-5.2-codex",
      "gpt-5.4-mini",
      "gpt-4o-2024-11-20",
    ]);

    expect(visible).toContain("gpt-5.2-codex");
    expect(visible).toContain("gpt-5.4-mini");
    expect(visible).toContain("gpt-4o");
    expect(visible).not.toContain("text-embedding-3-large");
    expect(visible).not.toContain("gpt-image-1");
    expect(visible).not.toContain("gpt-4o-2024-11-20");
  });

  it("keeps preserved models even when they would normally be deduped away", () => {
    const visible = filterModelIdsForDisplay(
      "openai",
      ["gpt-4o", "gpt-4o-2024-11-20", "gpt-5.2-codex"],
      ["gpt-4o-2024-11-20"],
    );

    expect(visible).toContain("gpt-4o-2024-11-20");
    expect(visible).toContain("gpt-5.2-codex");
  });

  it("keeps the full detected list for local providers instead of trimming it away", () => {
    const visible = filterModelIdsForDisplay("ollama", [
      "llama3.2:1b",
      "llama3.2:3b",
      "llama3.1:8b",
      "qwen2.5-coder:7b",
      "deepseek-r1:8b",
      "mistral-nemo",
      "phi4",
      "gemma3:4b",
      "codestral",
      "yi-coder",
      "tinyllama",
      "mixtral",
    ]);

    expect(visible).toHaveLength(12);
    expect(visible).toContain("tinyllama");
    expect(visible).toContain("mixtral");
  });

  it("does not keep undetected local providers visible in the model picker", () => {
    const spy = vi.spyOn(config, "getBaseUrl").mockReturnValue(undefined);
    const registry = new ProviderRegistry() as any;
    registry.providers = [
      { id: "anthropic", name: "Anthropic", available: true, reason: "API key" },
      { id: "codex", name: "Codex", available: true, reason: "native login" },
    ];

    const options = registry.buildVisibleModelOptions(null, "", []);
    const providerIds = new Set(options.map((option: any) => option.providerId));

    expect(providerIds.has("ollama")).toBe(false);
    expect(providerIds.has("lmstudio")).toBe(false);
    expect(providerIds.has("llamacpp")).toBe(false);
    spy.mockRestore();
  });

  it("keeps an explicitly configured local provider visible in the model picker", () => {
    const spy = vi.spyOn(config, "getBaseUrl").mockImplementation((providerId: string) => (
      providerId === "llamacpp" ? "http://127.0.0.1:8080/v1" : undefined
    ));
    const registry = new ProviderRegistry() as any;
    registry.providers = [
      { id: "anthropic", name: "Anthropic", available: true, reason: "API key" },
    ];

    const options = registry.buildVisibleModelOptions(null, "", []);
    const providerIds = new Set(options.map((option: any) => option.providerId));

    expect(providerIds.has("llamacpp")).toBe(true);
    spy.mockRestore();
  });

  it("keeps Codex limited to its curated visible model set instead of importing broad OpenAI ids", () => {
    syncCloudProviderModelsFromCatalog();
    expect(supportsProviderModel("codex", "gpt-5-mini")).toBe(true);
    expect(supportsProviderModel("codex", "gpt-4.1")).toBe(false);
  });

  it("falls back to the provider default when a restored model id is no longer visible", () => {
    expect(resolveVisibleProviderModelId("codex", "gpt-4.1")).toBe("gpt-5-mini");
  });

  it("does not surface stale pinned or current model ids that the provider no longer supports", () => {
    const registry = new ProviderRegistry() as any;
    registry.providers = [
      { id: "codex", name: "Codex", available: true, reason: "native login" },
    ];

    const options = registry.buildVisibleModelOptions(
      { provider: { id: "codex", name: "Codex", defaultModel: "gpt-5-mini", models: ["gpt-5-mini"] }, modelId: "gpt-5-mini", runtime: "native-cli" },
      "gpt-4.1",
      ["codex/gpt-4.1"],
    );

    const modelIds = options.filter((option) => option.providerId === "codex").map((option) => option.modelId);
    expect(modelIds).not.toContain("gpt-4.1");
    expect(modelIds).toContain("gpt-5-mini");
  });

  it("does not force routed-but-unavailable providers into the model picker", () => {
    const registry = new ProviderRegistry() as any;
    registry.providers = [
      { id: "codex", name: "Codex", available: true, reason: "native login" },
    ];

    const previousReview = config.getConfiguredModelPreference("review");
    try {
      config.updateModelPreference("review", "llamacpp/qwen2.5-coder");
      const options = buildVisibleRuntimeModelOptions(
        registry,
        { provider: { id: "codex", name: "Codex", defaultModel: "gpt-5-mini", models: ["gpt-5-mini"] }, modelId: "gpt-5-mini", runtime: "native-cli" },
        "gpt-5-mini",
        [{ id: "codex", name: "Codex", available: true, reason: "native login" }] as any,
      );

      const providerIds = new Set(options.map((option) => option.providerId));
      expect(providerIds.has("codex")).toBe(true);
      expect(providerIds.has("llamacpp")).toBe(false);
      expect(options.some((option) => option.displayName === "GPT-5 mini")).toBe(true);
    } finally {
      config.updateModelPreference("review", previousReview ?? null);
    }
  });
});
