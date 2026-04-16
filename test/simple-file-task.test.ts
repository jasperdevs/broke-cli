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
    const task = detectSimpleFileTask("edit README.md");
    const policy = applySimpleFileTaskPolicy(getTurnPolicy("edit README.md"), task);

    expect(task).toMatchObject({
      kind: "edit",
      path: "README.md",
      preRead: true,
      requiredTool: "editFile",
    });
    expect(policy.allowedTools).toEqual(["editFile"]);
    expect(policy.maxToolSteps).toBe(1);
    expect(policy.scaffold).toContain("lane: simple-file-action");
  });

  it("marks simple read tasks as small-executor friendly", () => {
    const task = detectSimpleFileTask("show README.md");
    const policy = applySimpleFileTaskPolicy(getTurnPolicy("show README.md"), task);

    expect(task?.kind).toBe("read");
    expect(policy.preferSmallExecutor).toBe(true);
    expect(policy.historyWindow).toBe(1);
  });

  it("keeps the edit/write/read payload contract explicit and structural", () => {
    const task = detectSimpleFileTask("edit README.md");
    expect(task).toBeTruthy();

    const block = buildSimpleFileTaskPromptBlock(task!);

    expect(block).toContain("required_tool: editFile");
    expect(block).toContain('readFile args: {"path":"target"}');
    expect(block).toContain('writeFile args: {"path":"target","content":"complete file content"}');
    expect(block).toContain('editFile args: {"path":"target","edits":[{"oldText":"exact unique text from read context","newText":"replacement"}]}');
    expect(block).not.toContain("steps:");
  });

  it("leaves multi-action file requests on the normal turn lane", () => {
    expect(detectSimpleFileTask("Fix add() in bug.js so npm test passes, add a regression test, and run npm test.")).toBeNull();
    expect(detectSimpleFileTask("edit README.md and run the test")).toBeNull();
  });

  it("does not treat framework names as target files", () => {
    expect(detectSimpleFileTask("make a folder and a simple snake game in Three.js")).toBeNull();
    expect(detectSimpleFileTask("make a folder and a simple Three.js snake game")).toBeNull();
    expect(detectSimpleFileTask("create a page with React.js")).toBeNull();
    expect(detectSimpleFileTask("create index.html")).toMatchObject({
      kind: "create",
      path: "index.html",
    });
  });
});
