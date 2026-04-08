import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildTaskExecutionAddendum } from "../src/core/context.js";

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

  it("tells the agent to keep required long-running services alive for verification", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off");

    expect(prompt).toContain("long-running process");
    expect(prompt).toContain("leave it running");
    expect(prompt).toContain("nohup");
    expect(prompt).toContain("do not rely on plain `&`");
  });

  it("uses a much smaller lightweight prompt for casual turns", () => {
    const fullPrompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "full");
    const casualPrompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "casual");

    expect(casualPrompt).toContain("This is a lightweight casual turn.");
    expect(casualPrompt).not.toContain("<tool-tips>");
    expect(casualPrompt).not.toContain("--- AGENTS.md ---");
    expect(casualPrompt.length).toBeLessThan(fullPrompt.length);
  });

  it("does not advertise tools that are not registered in the normal runtime", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off");

    expect(prompt).not.toContain("askUser");
  });

  it("adds detached-launch rules for server tasks", () => {
    const addendum = buildTaskExecutionAddendum("Create and run a server on port 3000 with one endpoint");

    expect(addendum).toContain("Server task rule");
    expect(addendum).toContain("nohup");
    expect(addendum).toContain("Do not rely on plain `&`");
    expect(addendum).toContain("JSON number");
    expect(addendum).toContain("curl");
  });

  it("does not add server rules for ordinary file edits", () => {
    expect(buildTaskExecutionAddendum("Rename this setting and update the docs")).toBe("");
  });
});
