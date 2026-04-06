import { describe, expect, it } from "vitest";
import { modelSupportsReasoning } from "../src/ai/model-catalog.js";

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
});
