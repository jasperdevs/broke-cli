import { describe, expect, it } from "vitest";
import { applySimpleFileTaskPolicy, detectSimpleFileTask } from "../src/core/simple-file-task.js";
import { getTurnPolicy } from "../src/core/turn-policy.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

function flowFor(prompt: string, cwd = process.cwd()): string[] {
  const task = detectSimpleFileTask(prompt, cwd);
  const policy = applySimpleFileTaskPolicy(getTurnPolicy(prompt), task);
  const flow: string[] = ["think-short"];
  if (task?.completeWithRead) {
    flow.push(`tool:readFile:${task.path}`);
    flow.push("final:short");
    return flow;
  }
  if (task?.preRead) flow.push(`tool:readFile:${task.path}`);
  if (task) flow.push(`tool:${task.requiredTool}:${task.path}`);
  else if (policy.allowedTools.length > 0) flow.push(`tool:${policy.allowedTools[0]}:?`);
  flow.push("final:short");
  return flow;
}

describe("concrete simple-file prompt flow", () => {
  it("routes index.html prompts to edit when the target exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "simple-file-flow-"));
    try {
      await writeFile(join(workspace, "index.html"), "<h1>Old</h1>\n", "utf8");
      expect(flowFor("make index.html better", workspace)).toEqual([
        "think-short",
        "tool:readFile:index.html",
        "tool:editFile:index.html",
        "final:short",
      ]);
      expect(flowFor("make an index.html file that’s cool", workspace)).toEqual([
        "think-short",
        "tool:readFile:index.html",
        "tool:editFile:index.html",
        "final:short",
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it.each([
    ["edit README.md", ["think-short", "tool:readFile:README.md", "tool:editFile:README.md", "final:short"]],
    ["read package.json", ["think-short", "tool:readFile:package.json", "final:short"]],
  ])("%s enters the constrained file-action pipeline", (prompt, expected) => {
    expect(flowFor(prompt)).toEqual(expected);
  });
});
