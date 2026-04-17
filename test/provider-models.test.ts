import { describe, expect, it } from "vitest";
import { filterModelIdsForDisplay, resolveVisibleProviderModelId, supportsProviderModel, syncCloudProviderModelsFromCatalog } from "../src/ai/providers.js";
import { ProviderRegistry } from "../src/ai/provider-registry.js";
import { SUPPORTED_PROVIDER_IDS, listProviders } from "../src/ai/provider-definitions.js";

describe("provider model filtering", () => {
  it("only exposes the five supported Vercel AI SDK providers", () => {
    expect(listProviders().map((provider) => provider.id).sort()).toEqual([...SUPPORTED_PROVIDER_IDS].sort());
  });

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

  it("hides legacy OpenAI reasoning models unless a routing slot preserves them", () => {
    const visible = filterModelIdsForDisplay("openai", [
      "gpt-5.4-mini",
      "gpt-5.4",
      "gpt-4.1",
      "o3",
      "o4-mini",
    ]);

    expect(visible).toContain("gpt-5.4-mini");
    expect(visible).not.toContain("gpt-4.1");
    expect(visible).not.toContain("o3");
    expect(visible).not.toContain("o4-mini");
    expect(filterModelIdsForDisplay("openai", ["gpt-5.4-mini", "o3"], ["o3"])).toContain("o3");
  });

  it("does not surface unsupported providers in the model picker", () => {
    const registry = new ProviderRegistry() as any;
    registry.providers = [
      { id: "openai", name: "OpenAI", available: true, reason: "configured auth" },
      { id: "codex", name: "Codex", available: true, reason: "native login" },
      { id: "ollama", name: "Ollama", available: true, reason: "running" },
    ];

    const options = registry.buildVisibleModelOptions(null, "", []);
    const providerIds = new Set(options.map((option: any) => option.providerId));

    expect(providerIds.has("openai")).toBe(true);
    expect(providerIds.has("codex")).toBe(false);
    expect(providerIds.has("ollama")).toBe(false);
  });

  it("syncs catalog models only for supported providers", () => {
    syncCloudProviderModelsFromCatalog();
    expect(supportsProviderModel("openai", "gpt-5.4-mini")).toBe(true);
    expect(supportsProviderModel("codex", "gpt-5.4-mini")).toBe(false);
    expect(resolveVisibleProviderModelId("codex", "gpt-5.4-mini")).toBe("gpt-5.4-mini");
  });
});
