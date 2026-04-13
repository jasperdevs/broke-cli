import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";
import { getSettings, updateSetting } from "../src/core/config.js";

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
    expect(output).toContain("ctrl+l");
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

  it("keeps compact chat metadata visible by merging it into the bottom bar", () => {
    const settings = getSettings();
    const original = { enableThinking: settings.enableThinking, thinkingLevel: settings.thinkingLevel };
    const app = new App() as any;
    let rendered: string[] = [];
    app.messages = [{ role: "assistant", content: "hello" }];
    app.modelName = "gpt-5.4-mini";
    app.modelProviderId = "openai";
    app.gitBranch = "main";
    app.mode = "plan";
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

    try {
      updateSetting("enableThinking", true);
      updateSetting("thinkingLevel", "high");
      app.drawImmediate();

      const output = rendered.map((line) => stripAnsi(line)).join("\n");
      expect(output).toContain("GPT-5.4 mini");
      expect(output).toContain("main");
      expect(output).toContain("plan");
      expect(output).toContain("high");
      expect(output).not.toContain("/ commands");
      expect(output).not.toContain("@ files");
    } finally {
      updateSetting("enableThinking", original.enableThinking);
      updateSetting("thinkingLevel", original.thinkingLevel);
    }
  });

  it("renders picker details in one detail strip instead of below every model lane", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.messages = [{ role: "assistant", content: "hello" }];
    app.modelPicker = {
      cursor: 0,
      options: [{ providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", displayName: "GPT-5.4 mini", active: false }],
    };
    app.openModelLanePicker(0);
    app.screen = {
      height: 18,
      width: 76,
      hasSidebar: false,
      mainWidth: 76,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.drawImmediate();

    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Use everywhere");
    expect(output).toContain("Use for chat");
    expect(output.match(/switch to it now and make it the main chat model/g)?.length).toBe(1);
  });

  it("wraps long picker detail copy instead of truncating it away", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.messages = [{ role: "assistant", content: "hello" }];
    app.modelPicker = {
      cursor: 0,
      options: [{ providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", displayName: "GPT-5.4 mini", active: false }],
    };
    app.openModelLanePicker(0);
    app.screen = {
      height: 18,
      width: 46,
      hasSidebar: false,
      mainWidth: 46,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.drawImmediate();

    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("switch to it now");
    expect(output).toMatch(/main chat\s+model/);
  });

  it("uses a taller default menu row budget when the interactive app starts", () => {
    const app = new App() as any;
    app.screen = {
      enter: () => {},
      exit: () => {},
      dispose: () => {},
      height: 24,
      width: 80,
      hasSidebar: false,
      mainWidth: 80,
      sidebarWidth: 0,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.keypress = {
      start: () => {},
      stop: () => {},
      setMouseTracking: () => {},
    };

    app.start();
    try {
      expect(getSettings().autocompleteMaxVisible).toBeGreaterThanOrEqual(8);
    } finally {
      app.running = false;
      process.stdout.off("resize", app.handleResize);
      app.keypress.stop();
      app.screen.exit();
      app.screen.dispose();
    }
  });
});
