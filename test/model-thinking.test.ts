import { describe, expect, it } from "vitest";
import { modelSupportsReasoning } from "../src/ai/model-catalog.js";
import { buildModelVisibleThinkingInstruction, shouldEnforceToolFirstTurn, shouldRequestThinkTags } from "../src/cli/turn-runner-support.js";

describe("model reasoning support", () => {
  it("tracks reasoning-capable frontier models from the catalog", () => {
    expect(modelSupportsReasoning("gpt-5.4-mini", "openai")).toBe(true);
    expect(modelSupportsReasoning("claude-sonnet-4-6", "anthropic")).toBe(true);
    expect(modelSupportsReasoning("gemini-2.5-pro", "google")).toBe(true);
  });

  it("keeps non-reasoning models off", () => {
    expect(modelSupportsReasoning("gpt-4o-mini", "openai")).toBe(false);
    expect(modelSupportsReasoning("claude-3-haiku-20240307", "anthropic")).toBe(false);
    expect(modelSupportsReasoning("default", "llamacpp")).toBe(false);
  });

  it("does not ask models to externalize private reasoning into visible text", () => {
    expect(shouldRequestThinkTags({
      provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-4o-mini", models: ["gpt-4o-mini"] },
      modelId: "gpt-4o-mini",
      runtime: "sdk",
    }, true)).toBe(false);
    expect(shouldRequestThinkTags({
      provider: { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4-6", models: ["claude-sonnet-4-6"] },
      modelId: "claude-sonnet-4-6",
      runtime: "sdk",
    }, true)).toBe(false);
  });

  it("flags fake edit completions that claim success without tool activity", () => {
    expect(shouldEnforceToolFirstTurn({
      text: "make a index.html file thats cool",
      assistantText: "Added index.html with a modern landing page. Commit/push now.",
      toolActivity: false,
      policy: { archetype: "edit", allowedTools: ["readFile", "writeFile"] },
      model: {
        provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: ["gpt-5.4-mini"] },
        modelId: "gpt-5.4-mini",
        runtime: "sdk",
        model: {} as any,
      },
    })).toBe(true);
    expect(shouldEnforceToolFirstTurn({
      text: "make a index.html file thats cool",
      assistantText: "What style do you want?",
      toolActivity: false,
      policy: { archetype: "edit", allowedTools: ["readFile", "writeFile"] },
      model: {
        provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: ["gpt-5.4-mini"] },
        modelId: "gpt-5.4-mini",
        runtime: "sdk",
        model: {} as any,
      },
    })).toBe(false);
  });

  it("asks model-visible think tags to follow caveman style", () => {
    const prompt = buildModelVisibleThinkingInstruction("ultra");
    expect(prompt).toContain("<think>");
    expect(prompt).toContain("clipped, direct");
    expect(prompt).toContain("no checklist");
    expect(buildModelVisibleThinkingInstruction("off")).toContain("plain text, concise");
  });
});
