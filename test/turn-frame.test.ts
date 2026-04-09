import { describe, expect, it } from "vitest";
import { applyTurnFrame, buildTurnFrame } from "../src/cli/turn-frame.js";

describe("turn frame", () => {
  it("does not inject internal scaffolds into no-tool conversational turns", () => {
    const messages = [{ role: "user" as const, content: "what?" }];
    const next = applyTurnFrame(messages, "what?", "question: lane direct\nanswer first", []);

    expect(next).toEqual(messages);
    expect(buildTurnFrame("what?", "question: lane direct\nanswer first", [])).toBe("");
  });

  it("still injects the execution frame when tools or task rules are present", () => {
    expect(buildTurnFrame("read package.json", "explore: search first", ["readFile"])).toContain("explore: search first");
    expect(buildTurnFrame("run npm test", "shell: run once", ["bash"])).toContain("shell: run once");
  });
});
