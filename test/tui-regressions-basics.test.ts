import { describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";
import { buildBudgetReport } from "../src/core/budget-insights.js";
import { App } from "../src/tui/app.js";
import { MOUSE_OFF, MOUSE_ON } from "../src/utils/ansi.js";
import { ALT_SCREEN_OFF, ALT_SCREEN_ON } from "../src/utils/ansi.js";
import { visibleWidth } from "../src/utils/terminal-width.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import { currentTheme } from "../src/core/themes.js";
import stripAnsi from "strip-ansi";
import type { Keypress } from "../src/tui/keypress.js";
import { renderStaticMessages } from "../src/tui/render/messages.js";
import { wordWrap } from "../src/tui/render/formatting.js";
import { Screen } from "../src/tui/screen.js";

describe("session token accounting", () => {
  it("keeps separate input and output totals", () => {
    const session = new Session("test-session");
    session.addUsage(120, 45, 0.0012);
    session.addUsage(30, 15, 0.0004);
    expect(session.getTotalInputTokens()).toBe(150);
    expect(session.getTotalOutputTokens()).toBe(60);
    expect(session.getTotalTokens()).toBe(210);
  });
});

describe("mouse reporting mode", () => {
  it("keeps mouse tracking disabled so terminal text selection stays native", () => {
    expect(MOUSE_ON).toBe("");
    expect(MOUSE_OFF).toBe("");
  });

  it("does not enable terminal mouse capture even when the sidebar is visible", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    expect(app.shouldEnableMenuMouse()).toBe(false);
  });
});

describe("screen buffer mode", () => {
  it("enters the alternate screen so the TUI stays fullscreen instead of living in scrollback", () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    (process.stdout.write as unknown as (chunk: any, ...args: any[]) => boolean) = ((chunk: any, ...args: any[]) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const screen = new Screen();
      screen.enter();
      screen.exit();
      expect(writes.join("")).toContain(ALT_SCREEN_ON);
      expect(writes.join("")).toContain(ALT_SCREEN_OFF);
    } finally {
      (process.stdout.write as unknown as typeof process.stdout.write) = originalWrite;
    }
  });
});

describe("message wrapping", () => {
  it("wraps system output without chopping ordinary words mid-line", () => {
    const lines = renderStaticMessages({
      messages: [{ role: "system", content: "warning: in the working copy of index.html LF will be replaced by CRLF the next time Git touches it" }],
      maxWidth: 32,
      toolOutputCollapsed: false,
      isToolOutput: () => false,
      wordWrap,
      colors: { imageTagBg: "", userBg: "", userText: "", border: "", muted: "", text: "" },
      reset: "",
      bold: "",
    }).map((line) => stripAnsi(line));
    expect(lines.join("\n")).toContain("working");
    expect(lines.join("\n")).toContain("replaced");
    expect(lines.join("\n")).not.toContain("wor\nking");
  });
});

describe("sidebar token summary", () => {
  it("renders total plus input and output counts", () => {
    const app = new App() as any;
    app.setContextUsage(132, 344_000);
    app.updateUsage(0.0016, 150, 60);
    expect(app.renderTokenSummaryParts()).toEqual(["$0.0016", "210 total", "150 in", "60 out"]);
  });

  it("shows only lifetime totals plus current context usage in the sidebar footer", () => {
    const originalShowTokens = getSettings().showTokens;
    updateSetting("showTokens", true);
    const app = new App() as any;
    app.setContextUsage(132, 344_000);
    app.updateUsage(0.0016, 150, 60);
    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
    expect(footer).not.toContain("Session");
    expect(footer).not.toContain("Next request");
    expect(footer).toContain("210 total");
    expect(footer).toContain("$0.0016");
    expect(footer).toContain("150 in");
    expect(footer).toContain("60 out");
    expect(footer).toContain("132 ctx");
    expect(footer).toContain("<1%");
    expect(footer).toContain("▰");
    updateSetting("showTokens", originalShowTokens);
  });

  it("keeps the token region to totals plus explicitly labeled context", () => {
    const originalShowTokens = getSettings().showTokens;
    updateSetting("showTokens", true);
    const app = new App() as any;
    app.screen = { sidebarWidth: 12, width: 80, height: 24, hasSidebar: true, mainWidth: 61, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    updateSetting("cavemanLevel", "ultra");
    app.setContextUsage(132_000, 344_000);
    app.updateUsage(0.0016, 150, 60);
    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line));
    expect(footer.some((line: string) => line.trim() === "210 total")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "$0.0016")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "150 in")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "60 out")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "132k ctx")).toBe(true);
    expect(footer.some((line: string) => line.includes("38%"))).toBe(true);
    expect(footer.some((line: string) => line.includes("▰") || line.includes("▱"))).toBe(true);
    updateSetting("cavemanLevel", "off");
    updateSetting("showTokens", originalShowTokens);
  });

  it("shows less-than-one-percent prompt usage instead of rounding down to zero", () => {
    const originalShowTokens = getSettings().showTokens;
    updateSetting("showTokens", true);
    const app = new App() as any;
    app.setContextUsage(822, 400_000);
    app.updateUsage(0.0016, 150, 60);
    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
    expect(footer).toContain("822 ctx");
    expect(footer).toContain("<1%");
    expect(footer).toContain("▰");
    updateSetting("showTokens", originalShowTokens);
  });

  it("keeps mode, thinking, and caveman badges in the bottom bar when the main footer owns status", () => {
    const app = new App() as any;
    const settings = getSettings();
    const original = { thinkingLevel: settings.thinkingLevel, enableThinking: settings.enableThinking, cavemanLevel: settings.cavemanLevel };
    try {
      updateSetting("thinkingLevel", "low");
      updateSetting("enableThinking", true);
      updateSetting("cavemanLevel", "ultra");
      app.messages = [{ role: "user", content: "hello" }];
      let rendered: string[] = [];
      app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
      app.drawImmediate();
      const output = rendered.map((line) => stripAnsi(line)).join("\n");
      expect(output).toContain("build");
      expect(output).toContain("low");
      expect(output).toContain("ultra");
      expect(output).toContain("🪨");
    } finally {
      updateSetting("thinkingLevel", original.thinkingLevel);
      updateSetting("enableThinking", original.enableThinking);
      updateSetting("cavemanLevel", original.cavemanLevel ?? "off");
    }
  });
});

describe("menu counters", () => {
  it("shows a count in the slash command suggestion menu", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.input.setText("/");
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Commands (1/");
  });

  it("shows a count in item pickers", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.openItemPicker("Projects", [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ], () => {}, { kind: "projects" });
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Projects (1/2)");
  });
});

describe("terminal cell width", () => {
  it("pads and decorates frame lines to the exact terminal width even with emoji and ANSI", () => {
    const app = new App() as any;
    const raw = ` ${currentTheme().warning}🪨 ultra${"\x1b[0m"} | ${currentTheme().textMuted}total 210${"\x1b[0m"}`;
    const padded = app.padLine(raw, 18);
    const framed = app.decorateFrameLine(`${padded} ${app.getSidebarBorder()} ${app.padLine("Directory", 10)}`, 31);
    expect(visibleWidth(framed)).toBe(31);
    expect(visibleWidth(app.decorateFrameLine(raw, 18))).toBe(18);
  });
});

describe("startup home view", () => {
  it("starts without the sidebar and keeps recent sessions compact", () => {
    const app = new App() as any;
    app.providerName = "openai";
    app.modelName = "gpt-5.4-mini";
    app.appVersion = "1.2.3";
    app.cwd = "C:\\Users\\bunny\\Downloads\\broke-cli";
    app.homeTip = "Use /resume to jump back in without wasting time on manual session hunting.";
    let rendered: string[] = [];
    app.screen = { height: 20, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    const firstCardLine = rendered.find((line) => stripAnsi(line).includes("╭")) ?? "";
    expect(stripAnsi(firstCardLine)).toContain("╭");
    expect(output).toContain("Welcome");
    expect(output).toContain("openai/gpt-5.4-mini");
    expect(output).toContain("~\\Downloads\\broke-cli");
    expect(output).toContain("Tip");
    expect(output).not.toContain("Files");
    expect(output).not.toContain("Recent Sessions");
  });

  it("renders an update banner above the startup card when a newer version is available", () => {
    const app = new App() as any;
    app.setUpdateNotice({
      currentVersion: "0.0.1",
      latestVersion: "0.0.2",
      method: "npm",
      instruction: "Run: npm install -g @jasperdevs/brokecli@latest",
      releasesUrl: "https://github.com/jasperdevs/brokecli/releases/latest",
      command: {
        command: "npm",
        args: ["install", "-g", "@jasperdevs/brokecli@latest"],
        display: "npm install -g @jasperdevs/brokecli@latest",
      },
    });
    let rendered: string[] = [];
    app.screen = { height: 24, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Update available");
    expect(output).toContain("Latest v0.0.2");
    expect(output).toContain("/update");
    expect(output).toContain("Welcome");
  });

  it("only enables the sidebar after chat starts", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).not.toContain("Files");
    app.messages = [{ role: "user", content: "hello" }];
    app.drawImmediate();
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("Files");
  });

  it("drops the startup card entirely on very narrow widths", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 18, width: 20, hasSidebar: false, mainWidth: 20, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).not.toContain("Welcome");
    expect(output).not.toContain("▀");
    expect(output).not.toContain("█");
  });

  it("hides the startup card entirely in cramped panes so it does not leak into the input area", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 8, width: 20, hasSidebar: false, mainWidth: 20, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.input.paste("hey");
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).not.toContain("Welcome");
    expect(output).not.toContain("▀");
    expect(output).not.toContain("█");
    expect(output).toContain("hey");
  });
});

describe("input editing", () => {
  it("uses the normal prompt box as the filter input for settings menus", () => {
    const app = new App() as any;
    app.openSettings([
      { key: "autoSaveSessions", label: "Auto-save sessions", value: "true", description: "Save history" },
      { key: "showTokens", label: "Show tokens", value: "true", description: "Show token counts" },
    ], () => {});
    expect(app.input.getText()).toBe("/settings ");
    app.handleKey({ name: "s", char: "s", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("/settings s");
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("/settings ");
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.settingsPicker).toBeNull();
    expect(app.input.getText()).toBe("");
  });

  it("uses the normal prompt box as the filter input for picker menus", () => {
    const app = new App() as any;
    app.openItemPicker("Theme", [
      { id: "brokecli-dark", label: "Default Dark", detail: "dark" },
      { id: "brokecli-light", label: "Default Light", detail: "light" },
    ], () => {}, { kind: "theme" });
    expect(app.input.getText()).toBe("/theme ");
    for (const char of "light") app.handleKey({ name: char, char, ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("/theme light");
    expect(app.getFilteredItems().map((item: any) => item.id)).toEqual(["brokecli-light"]);
    for (let i = 0; i < "light".length; i++) app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("/theme ");
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.itemPicker).toBeNull();
    expect(app.input.getText()).toBe("");
  });

  it("lets backspace exit fullscreen menu-style views too", () => {
    const app = new App() as any;
    const session = new Session("budget-test");
    session.addUsage(12, 3, 0);
    const report = buildBudgetReport(session);
    app.openBudgetView("Budget Inspector", { all: report, session: report });
    expect(app.budgetView).not.toBeNull();
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.budgetView).toBeNull();
  });

  it("does not persist plan/build mode when Shift+Tab toggles it", () => {
    const originalMode = getSettings().mode;
    const app = new App() as any;
    try {
      updateSetting("mode", "build");
      app.handleKey({ name: "tab", char: "", ctrl: false, meta: false, shift: true });
      expect(app.mode).toBe("plan");
      expect(getSettings().mode).toBe("build");
      app.handleKey({ name: "tab", char: "", ctrl: false, meta: false, shift: true });
      expect(app.mode).toBe("build");
    } finally {
      updateSetting("mode", originalMode);
    }
  });

  it("deletes the previous word with Ctrl+Backspace", () => {
    const app = new App() as any;
    app.input.paste("hello brave world");
    const key: Keypress = { name: "backspace", char: "", ctrl: true, meta: false, shift: false };
    app.input.handleKey(key);
    expect(app.input.getText()).toBe("hello brave ");
  });

  it("deletes the previous word when terminals report Ctrl+Backspace as Ctrl+H", () => {
    const app = new App() as any;
    app.input.paste("hello brave world");
    const key: Keypress = { name: "h", char: "\b", ctrl: true, meta: false, shift: false };
    app.input.handleKey(key);
    expect(app.input.getText()).toBe("hello brave ");
  });

  it("ignores plain tab so the input never gets a raw tab character", () => {
    const app = new App() as any;
    app.input.paste("hello");
    app.input.handleKey({ name: "tab", char: "\t", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("hello");
  });

  it("queues a follow-up with Tab while streaming", () => {
    const app = new App() as any;
    app.isStreaming = true;
    app.onSubmit = () => {};
    app.input.paste("hey");
    app.handleKey({ name: "tab", char: "\t", ctrl: false, meta: false, shift: false });
    expect(app.pendingMessages).toEqual([{ text: "hey", images: [], delivery: "followup" }]);
  });

  it("queues steering with Enter while streaming", () => {
    const app = new App() as any;
    app.isStreaming = true;
    app.onSubmit = () => {};
    app.input.paste("steer");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });
    expect(app.pendingMessages).toEqual([{ text: "steer", images: [], delivery: "steering" }]);
  });

  it("shows queued messages in the active work block", () => {
    const app = new App() as any;
    app.messages = [{ role: "assistant", content: "working" }];
    app.isStreaming = true;
    app.streamStartTime = Date.now() - 1000;
    app.addPendingMessage("next step", [], "followup");
    const output = app.renderMessages(50).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("Composing...");
    expect(output).toContain("Queued follow-up messages");
    expect(output).toContain("next step");
  });

  it("keeps shift-enter as a newline even when slash suggestions are visible", () => {
    const app = new App() as any;
    app.input.paste("/");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: true });
    expect(app.input.getText()).toBe("/\n");
  });

  it("does not show an empty reasoning block when no reasoning text arrives", () => {
    const app = new App() as any;
    app.messages = [{ role: "assistant", content: "Reading files" }];
    app.isStreaming = true;
    app.setThinkingRequested(true);
    app.streamStartTime = Date.now() - 1000;
    const output = app.renderMessages(60).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("Thinking...");
    expect(output).not.toContain("waiting for model reasoning");
    expect(output).not.toContain("Reasoning\n");
  });

  it("treats linefeed as a newline instead of submit", () => {
    const app = new App() as any;
    app.input.paste("hello");
    app.handleKey({ name: "linefeed", char: "\n", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("hello\n");
  });

  it("restores the last queued message with Alt+Up and removes it from the queue", () => {
    const app = new App() as any;
    app.addPendingMessage("first", [], "followup");
    app.addPendingMessage("second", [], "steering");
    app.handleKey({ name: "up", char: "", ctrl: false, meta: true, shift: false });
    expect(app.input.getText()).toBe("second");
    expect(app.pendingMessages).toEqual([{ text: "first", images: [], delivery: "followup" }]);
    app.input.setText("");
    app.handleKey({ name: "up", char: "", ctrl: false, meta: true, shift: false });
    expect(app.input.getText()).toBe("first");
    expect(app.pendingMessages).toEqual([]);
  });

  it("clears queued messages with Escape when idle and the editor is empty", () => {
    const app = new App() as any;
    app.addPendingMessage("first", [], "followup");
    app.addPendingMessage("second", [], "steering");
    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
    expect(app.pendingMessages).toEqual([]);
  });
});
