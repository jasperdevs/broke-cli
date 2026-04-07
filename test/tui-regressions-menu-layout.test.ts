import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";

describe("menu layout regressions", () => {
  it("keeps the bottom info bar visible when a picker is open in a cramped pane", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.messages = [{ role: "assistant", content: "hello" }];
    app.screen = {
      height: 12,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.openItemPicker("Projects", [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ], () => {}, { kind: "projects" });
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Projects");
    expect(output).toContain("Alpha");
    expect(output).toContain("Beta");
    expect(output).toContain("build");
  });

  it("keeps multiple slash suggestions visible in a short pane", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = {
      height: 10,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.input.setText("/m");
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Commands");
    expect(output).toContain("model");
    expect(output).toContain("mode");
    expect(output).toContain("build");
  });

  it("does not crash when compaction starts from the tree summarize flow", () => {
    const app = new App() as any;
    app.screen = { height: 12, width: 40, hasSidebar: false, mainWidth: 40, sidebarWidth: 0, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    try {
      global.setInterval = ((fn: (...args: any[]) => void) => {
        fn();
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof global.setInterval;
      global.clearInterval = (() => undefined) as typeof global.clearInterval;
      expect(() => app.setCompacting(true, 42)).not.toThrow();
      app.setCompacting(false);
    } finally {
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    }
  });
});
