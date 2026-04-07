import { describe, expect, it } from "vitest";
import { modelSupportsReasoning } from "../src/ai/model-catalog.js";
import { shouldRequestThinkTags } from "../src/cli/turn-runner-support.js";

describe("model reasoning support", () => {
  it("tracks reasoning-capable frontier models from the catalog", () => {
    expect(modelSupportsReasoning("gpt-5.4-mini", "openai")).toBe(true);
    expect(modelSupportsReasoning("gpt-5-mini", "codex")).toBe(true);
    expect(modelSupportsReasoning("gemini-2.5-pro", "google")).toBe(true);
  });

  it("keeps non-reasoning models off", () => {
    expect(modelSupportsReasoning("gpt-4o-mini", "openai")).toBe(false);
    expect(modelSupportsReasoning("claude-haiku-4-5-20251001", "anthropic")).toBe(false);
    expect(modelSupportsReasoning("default", "llamacpp")).toBe(false);
  });

  it("still requests think tags for sdk models when thinking is enabled", () => {
    expect(shouldRequestThinkTags({
      provider: { id: "llamacpp", name: "llama.cpp", defaultModel: "default", models: ["default"] },
      modelId: "default",
      runtime: "sdk",
    }, true)).toBe(true);
    expect(shouldRequestThinkTags({
      provider: { id: "codex", name: "Codex", defaultModel: "gpt-5-mini", models: ["gpt-5-mini"] },
      modelId: "gpt-5-mini",
      runtime: "native-cli",
    }, true)).toBe(false);
  });
});
