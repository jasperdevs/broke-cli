import { describe, expect, it } from "vitest";
import { pickCheapestDetectedModel, pickDefault } from "../src/ai/detect.js";
import { resolveOneShotModel } from "../src/cli/oneshot.js";

describe("budget-first provider selection", () => {
  it("ignores unsupported providers when picking the cheapest available provider/model pair", () => {
    const resolved = pickCheapestDetectedModel([
      { id: "anthropic", name: "Anthropic", available: true, reason: "configured auth" },
      { id: "openai", name: "OpenAI", available: true, reason: "configured auth" },
      { id: "ollama", name: "Ollama", available: true, reason: "running" },
    ]);

    expect(resolved).toEqual({
      providerId: "openai",
      modelId: "gpt-4o-mini",
    });
  });

  it("uses the cheapest supported detected pair in one-shot broke mode", async () => {
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
        { id: "anthropic", name: "Anthropic", available: true, reason: "configured auth" },
        { id: "openai", name: "OpenAI", available: true, reason: "configured auth" },
        { id: "ollama", name: "Ollama", available: true, reason: "running" },
      ],
      providerRegistry,
    });

    expect(resolved.providerId).toBe("openai");
    expect(resolved.modelId).toBe("gpt-4o-mini");
  });

  it("ignores aggregator providers outside the supported SDK set", () => {
    const resolved = pickCheapestDetectedModel([
      { id: "openrouter", name: "OpenRouter", available: true, reason: "configured auth" },
      { id: "anthropic", name: "Anthropic", available: true, reason: "configured auth" },
    ]);

    expect(resolved).toEqual({
      providerId: "anthropic",
      modelId: "claude-haiku-4-5-20251001",
    });
  });

  it("prefers the first supported available provider for default startup", () => {
    const resolved = pickDefault([
      { id: "codex", name: "Codex", available: true, reason: "native login" },
      { id: "openai", name: "OpenAI", available: true, reason: "configured auth" },
    ]);

    expect(resolved?.id).toBe("openai");
  });
});
