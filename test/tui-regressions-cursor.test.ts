import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";

describe("input layout", () => {
  it("keeps the cursor on the input row below the separator", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    let cursorRow = 0;
    app.messages = [{ role: "assistant", content: "hello" }];
    app.input.setText("test");
    app.screen = { height: 14, width: 60, hasSidebar: false, mainWidth: 60, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: (row: number) => { cursorRow = row; }, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const plain = rendered.map((line) => stripAnsi(line));
    const separatorRow = plain.findIndex((line) => line.includes("─".repeat(10))) + 1;
    expect(separatorRow).toBeGreaterThan(0);
    expect(cursorRow).toBeGreaterThan(separatorRow);
    expect(plain[cursorRow - 1]).toContain("test");
  });

  it("keeps the hardware cursor on the draft row while streaming in sidebar chat mode", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    let cursorRow = 0;
    let hidCursor = false;
    app.messages = [{ role: "assistant", content: "hello" }];
    app.setStreaming(true);
    app.input.setText("draft while streaming");
    app.screen = { height: 16, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: (lines: string[]) => { rendered = lines; }, setCursor: (row: number) => { cursorRow = row; }, hideCursor: () => { hidCursor = true; }, forceRedraw: () => {} };
    app.drawImmediate();
    expect(hidCursor).toBe(false);
    expect(stripAnsi(rendered[cursorRow - 1] ?? "")).toContain("draft while streaming");
  });
});
