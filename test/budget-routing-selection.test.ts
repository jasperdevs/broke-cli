import { describe, expect, it } from "vitest";
import { pickCheapestDetectedModel } from "../src/ai/detect.js";
import { resolveOneShotModel } from "../src/cli/oneshot.js";

describe("budget-first provider selection", () => {
  it("picks the cheapest available provider/model pair for broke mode", () => {
    const resolved = pickCheapestDetectedModel([
      { id: "anthropic", name: "Anthropic", available: true, reason: "API key" },
      { id: "openai", name: "OpenAI", available: true, reason: "API key" },
      { id: "ollama", name: "Ollama", available: true, reason: "running" },
    ]);

    expect(resolved).toEqual({
      providerId: "ollama",
      modelId: "qwen2.5-coder:7b",
    });
  });

  it("uses the cheapest detected pair in one-shot broke mode", async () => {
    const providerRegistry = {
      createModel: (providerId: string, modelId?: string) => ({
        provider: { id: providerId, name: providerId, defaultModel: modelId ?? "default", models: [modelId ?? "default"] },
        modelId: modelId ?? "default",
        runtime: "sdk",
        model: {} as any,
      }),
    } as any;

    const resolved = await resolveOneShotModel({
      opts: { broke: true },
      providers: [
        { id: "anthropic", name: "Anthropic", available: true, reason: "API key" },
        { id: "openai", name: "OpenAI", available: true, reason: "API key" },
        { id: "ollama", name: "Ollama", available: true, reason: "running" },
      ],
      providerRegistry,
    });

    expect(resolved.providerId).toBe("ollama");
    expect(resolved.modelId).toBe("qwen2.5-coder:7b");
  });

  it("prefers known-priced candidates over unpriced aggregator models", () => {
    const resolved = pickCheapestDetectedModel([
      { id: "openrouter", name: "OpenRouter", available: true, reason: "API key" },
      { id: "anthropic", name: "Anthropic", available: true, reason: "API key" },
    ]);

    expect(resolved).toEqual({
      providerId: "anthropic",
      modelId: "claude-haiku-4-5-20251001",
    });
  });

  it("does not pick the unsupported SDK cheap lane for native Codex login", () => {
    const resolved = pickCheapestDetectedModel([
      { id: "codex", name: "Codex", available: true, reason: "native login" },
    ]);

    expect(resolved).toEqual({
      providerId: "codex",
      modelId: "gpt-5.4-mini",
    });
  });

  it("leans token-first across priced hosted candidates before using lower cost as a tie-breaker", () => {
    const resolved = pickCheapestDetectedModel([
      { id: "google", name: "Google", available: true, reason: "API key" },
      { id: "openai", name: "OpenAI", available: true, reason: "API key" },
    ]);

    expect(resolved).toEqual({
      providerId: "openai",
      modelId: "gpt-4o-mini",
    });
  });
});
