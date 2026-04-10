import { describe, expect, it } from "vitest";
import { createToolInvocationRegistry } from "../src/cli/tool-invocation-registry.js";

describe("tool invocation registry", () => {
  it("keeps multiple calls to the same tool separated by invocation id", () => {
    const registry = createToolInvocationRegistry();

    const first = registry.start("readFile");
    const second = registry.start("readFile");

    expect(first.invocationId).not.toBe(second.invocationId);

    registry.update("readFile", { path: "README.md" }, first.invocationId);
    registry.update("readFile", { path: "package.json" }, second.invocationId);

    const firstFinished = registry.finish("readFile", first.invocationId);
    const secondFinished = registry.finish("readFile", second.invocationId);

    expect(firstFinished.invocationId).toBe(first.invocationId);
    expect(secondFinished.invocationId).toBe(second.invocationId);
  });

  it("normalizes legacy tool names onto their canonical invocation key", () => {
    const registry = createToolInvocationRegistry();
    const record = registry.start("Read", "call_1");

    expect(record.toolName).toBe("readFile");
    expect(registry.update("readFile", { path: "README.md" }, "call_1").invocationId).toBe("call_1");
  });
});
