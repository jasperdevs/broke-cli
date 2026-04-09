import { describe, expect, it } from "vitest";
import { applySimpleFileTaskPolicy, buildSimpleFileTaskPromptBlock, detectSimpleFileTask } from "../src/core/simple-file-task.js";
import { getTurnPolicy } from "../src/core/turn-policy.js";

describe("simple file task contract", () => {
  it("detects bare read-file requests as runtime-complete reads", () => {
    const task = detectSimpleFileTask("read package.json");

    expect(task).toMatchObject({
      kind: "read",
      path: "package.json",
      existing: true,
      completeWithRead: true,
      requiredTool: "readFile",
    });
  });

  it("detects concrete existing-file edits and requires editFile", () => {
    const task = detectSimpleFileTask("make index.html better");
    const policy = applySimpleFileTaskPolicy(getTurnPolicy("make index.html better"), task);

    expect(task).toMatchObject({
      kind: "edit",
      path: "index.html",
      preRead: true,
      requiredTool: "editFile",
    });
    expect(policy.allowedTools).toEqual(["editFile"]);
    expect(policy.maxToolSteps).toBe(1);
    expect(policy.scaffold).toContain("lane: simple-file-action");
  });

  it("keeps the edit/write/read payload contract explicit and structural", () => {
    const task = detectSimpleFileTask("edit README.md");
    expect(task).toBeTruthy();

    const block = buildSimpleFileTaskPromptBlock(task!);

    expect(block).toContain("required_tool: editFile");
    expect(block).toContain('readFile args: {"path":"target"}');
    expect(block).toContain('writeFile args: {"path":"target","content":"complete file content"}');
    expect(block).toContain('editFile args: {"path":"target","old_string":"exact unique text from read context","new_string":"replacement"}');
    expect(block).not.toContain("steps:");
  });
});
