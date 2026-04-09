import { describe, expect, it } from "vitest";
import { applySimpleFileTaskPolicy, detectSimpleFileTask } from "../src/core/simple-file-task.js";
import { getTurnPolicy } from "../src/core/turn-policy.js";

function flowFor(prompt: string): string[] {
  const task = detectSimpleFileTask(prompt);
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
  it.each([
    ["make index.html better", ["think-short", "tool:readFile:index.html", "tool:editFile:index.html", "final:short"]],
    ["make an index.html file that’s cool", ["think-short", "tool:readFile:index.html", "tool:editFile:index.html", "final:short"]],
    ["edit README.md", ["think-short", "tool:readFile:README.md", "tool:editFile:README.md", "final:short"]],
    ["read package.json", ["think-short", "tool:readFile:package.json", "final:short"]],
  ])("%s enters the constrained file-action pipeline", (prompt, expected) => {
    expect(flowFor(prompt)).toEqual(expected);
  });
});
