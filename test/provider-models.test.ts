import { describe, expect, it } from "vitest";
import { filterModelIdsForDisplay } from "../src/ai/providers.js";
import { ProviderRegistry } from "../src/ai/provider-registry.js";

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

  it("keeps local providers visible in the model picker even if only cloud providers were detected", () => {
    const registry = new ProviderRegistry() as any;
    registry.providers = [
      { id: "anthropic", name: "Anthropic", available: true, reason: "API key" },
      { id: "codex", name: "Codex", available: true, reason: "native login" },
    ];

    const options = registry.buildVisibleModelOptions(null, "", []);
    const providerIds = new Set(options.map((option: any) => option.providerId));

    expect(providerIds.has("ollama")).toBe(true);
    expect(providerIds.has("lmstudio")).toBe(true);
    expect(providerIds.has("llamacpp")).toBe(true);
  });
});
