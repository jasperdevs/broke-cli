import { describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";
import { App } from "../src/tui/app.js";
import { renderStaticMessages } from "../src/tui/render/messages.js";
import { wordWrap } from "../src/tui/render/formatting.js";
import { MOUSE_OFF, MOUSE_ON } from "../src/utils/ansi.js";
import { currentTheme, setPreviewTheme } from "../src/core/themes.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import stripAnsi from "strip-ansi";
import type { Keypress } from "../src/tui/keypress.js";

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
  it("renders labeled input, output, and total counts", () => {
    const app = new App() as any;
    app.setContextUsage(132, 344_000);
    app.updateUsage(0.0016, 150, 60);
    expect(app.renderTokenSummaryParts()).toEqual(["Σ 210 session", "↑ 150 in", "↓ 60 out"]);
  });

  it("shows only lifetime totals plus current context usage in the sidebar footer", () => {
    const app = new App() as any;
    app.setContextUsage(132, 344_000);
    app.updateUsage(0.0016, 150, 60);
    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
    expect(footer).not.toContain("Session");
    expect(footer).not.toContain("Next request");
    expect(footer).toContain("Σ 210 session");
    expect(footer).toContain("↑ 150 in");
    expect(footer).toContain("↓ 60 out");
    expect(footer).toContain("132/344k");
    expect(footer).toContain("<1% of limit");
  });

  it("uses the rock indicator and keeps the token region to totals plus context", () => {
    const app = new App() as any;
    app.screen = { sidebarWidth: 12, width: 80, height: 24, hasSidebar: true, mainWidth: 61, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    updateSetting("cavemanLevel", "ultra");
    app.setContextUsage(132_000, 344_000);
    app.updateUsage(0.0016, 150, 60);
    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line));
    expect(footer.some((line: string) => line.includes("🪨 ultra"))).toBe(true);
    expect(footer[0]).toBe("");
    expect(footer.some((line: string) => line.trim() === "Σ 210 session")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "132k/344k")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "38% of limit")).toBe(true);
    updateSetting("cavemanLevel", "off");
  });

  it("shows less-than-one-percent prompt usage instead of rounding down to zero", () => {
    const app = new App() as any;
    app.setContextUsage(822, 400_000);
    app.updateUsage(0.0016, 150, 60);
    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
    expect(footer).toContain("822/400k");
    expect(footer).toContain("<1% of limit");
  });

  it("keeps mode, thinking, and caveman badges in the bottom bar even with a sidebar", () => {
    const app = new App() as any;
    const settings = getSettings();
    const original = { thinkingLevel: settings.thinkingLevel, enableThinking: settings.enableThinking, cavemanLevel: settings.cavemanLevel };
    try {
      updateSetting("thinkingLevel", "low");
      updateSetting("enableThinking", true);
      updateSetting("cavemanLevel", "ultra");
      app.messages = [{ role: "user", content: "hello" }];
      let rendered: string[] = [];
      app.screen = { height: 16, width: 80, hasSidebar: true, mainWidth: 57, sidebarWidth: 22, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
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
    expect(output).toContain("Welcome to BrokeCLI");
    expect(output).toContain("openai/gpt-5.4-mini");
    expect(output).toContain("~\\Downloads\\broke-cli");
    expect(output).toContain("Tip");
    expect(output).not.toContain("Files");
    expect(output).not.toContain("Recent Sessions");
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
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("/settings ");
  });

  it("uses the normal prompt box as the filter input for picker menus", () => {
    const app = new App() as any;
    app.openItemPicker("Theme", [
      { id: "brokecli-dark", label: "BrokeCLI Dark", detail: "dark" },
      { id: "brokecli-light", label: "BrokeCLI Light", detail: "light" },
    ], () => {}, { kind: "theme" });
    expect(app.input.getText()).toBe("/theme ");
    for (const char of "light") app.handleKey({ name: char, char, ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("/theme light");
    expect(app.getFilteredItems().map((item: any) => item.id)).toEqual(["brokecli-light"]);
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
});

describe("theme rendering", () => {
  it("applies theme text color to assistant markdown on light themes", () => {
    setPreviewTheme("brokecli-light");
    try {
      const lines = renderStaticMessages({
        messages: [{ role: "assistant", content: "Plain assistant text" }],
        maxWidth: 40,
        toolOutputCollapsed: false,
        isToolOutput: () => false,
        wordWrap,
        colors: { imageTagBg: "", userBg: "", userText: "", border: "", muted: currentTheme().textMuted, text: currentTheme().text },
        reset: "\u001b[0m",
        bold: "\u001b[1m",
      });
      expect(lines.join("\n")).toContain(currentTheme().text);
    } finally {
      setPreviewTheme(null);
    }
  });
});
