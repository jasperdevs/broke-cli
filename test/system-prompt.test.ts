import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/core/context.js";

describe("system prompt", () => {
  it("explicitly allows benign non-coding requests instead of refusing them", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off");

    expect(prompt).toContain("Never refuse a benign user request just because it is not code.");
    expect(prompt).toContain("writing, explanation, brainstorming, planning, or general help");
  });

  it("forbids exposing raw tool protocol text to the user", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off");

    expect(prompt).toContain("Never expose raw tool calls");
    expect(prompt).toContain("Never print pseudo-tool calls");
    expect(prompt).toContain("do not fake it");
  });
});
