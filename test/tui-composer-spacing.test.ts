import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";

describe("composer spacing", () => {
  it("shows queued messages directly above the composer", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.messages = [{ role: "assistant", content: "working" }];
    app.isStreaming = true;
    app.streamStartTime = Date.now() - 1000;
    app.screen = { height: 18, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.input.paste("draft");
    app.addPendingMessage("next step", [], "followup");
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line));
    const queueIndex = output.findIndex((line) => line.includes("Queued follow-up messages"));
    const inputIndex = output.findIndex((line) => line.includes("> draft"));
    expect(output.join("\n")).toContain("Working");
    expect(output.join("\n")).toContain("next step");
    expect(queueIndex).toBeGreaterThan(-1);
    expect(inputIndex).toBeGreaterThan(queueIndex);
    expect(inputIndex - queueIndex).toBeLessThanOrEqual(6);
  });

  it("keeps a spacer row above the composer so the input is not glued to the transcript", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.messages = [{ role: "assistant", content: "working" }];
    app.input.paste("hey");
    app.screen = { height: 14, width: 60, hasSidebar: false, mainWidth: 60, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line));
    const inputIndex = output.findIndex((line) => line.includes("> hey"));
    expect(inputIndex).toBeGreaterThan(1);
    expect(output[inputIndex - 2]?.trim()).toBe("");
  });
});
