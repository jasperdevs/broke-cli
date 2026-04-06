import { afterEach, describe, expect, it } from "vitest";
import { getTools } from "../src/tools/registry.js";
import { updateSetting } from "../src/core/config.js";
import { createSubagentTool } from "../src/tools/subagent.js";

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

  it("filters extra tools through the same permission gate", () => {
    updateSetting("deniedTools", ["subagent"]);
    const tools = getTools({
      extraTools: {
        subagent: createSubagentTool({
          cwd: () => process.cwd(),
          providerRegistry: {} as any,
          getActiveModel: () => null,
          getCurrentModelId: () => "",
        }),
      },
    });

    expect("subagent" in tools).toBe(false);
  });
});
