import { afterEach, describe, expect, it } from "vitest";
import { getTools } from "../src/tools/registry.js";
import { updateSetting } from "../src/core/config.js";
import { createAgentTool, buildAgentSystemPrompt } from "../src/tools/subagent.js";

describe("tool permissions", () => {
  afterEach(() => {
    updateSetting("deniedTools", []);
  });

  it("omits blocked tools from the registry", () => {
    updateSetting("deniedTools", ["bash", "writeFile"]);
    const tools = getTools();

    expect("bash" in tools).toBe(false);
    expect("writeFile" in tools).toBe(false);
    expect("readFile" in tools).toBe(true);
  });

  it("does not expose the legacy subagent tool name", () => {
    const tools = getTools();
    expect("agent" in tools).toBe(false);
    expect("subagent" in tools).toBe(false);
  });

  it("filters extra tools through the same permission gate", () => {
    updateSetting("deniedTools", ["subagent"]);
    const tools = getTools({
      extraTools: {
        agent: createAgentTool({
          cwd: () => process.cwd(),
          providerRegistry: {} as any,
          getActiveModel: () => null,
          getCurrentModelId: () => "",
        }),
      },
    });

    expect("agent" in tools).toBe(false);
  });

  it("uses an opencode-style stateless read-only agent prompt", () => {
    const prompt = buildAgentSystemPrompt(process.cwd(), "openai");
    expect(prompt).toContain("You are stateless.");
    expect(prompt).toContain("Use only read-only search and inspection tools.");
    expect(prompt).toContain("Return raw useful findings only.");
  });
});
