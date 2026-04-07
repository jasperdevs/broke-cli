import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import type { Keypress } from "../src/tui/keypress.js";
import { App } from "../src/tui/app.js";
import { Session } from "../src/core/session.js";
import { currentTheme } from "../src/core/themes.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import { renderStaticMessages } from "../src/tui/render/messages.js";
import { wordWrap } from "../src/tui/render/formatting.js";

describe("budget inspector", () => {
  it("opens as a fullscreen mode and closes with escape", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 12, width: 40, hasSidebar: true, mainWidth: 28, sidebarWidth: 11, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    const report = {
      sessionCount: 1,
      totalTokens: 240,
      inputTokens: 200,
      outputTokens: 40,
      plannerTokens: 30,
      plannerInputTokens: 20,
      plannerOutputTokens: 10,
      executorTokens: 210,
      executorInputTokens: 180,
      executorOutputTokens: 30,
      totalTurns: 3,
      avgTokensPerTurn: 80,
      toolsExposed: 6,
      toolsUsed: 2,
      toolExposureWaste: 4,
      idleCacheCliffs: 1,
      autoCompactions: 0,
      freshThreadCarryForwards: 0,
      smallModelTurns: 1,
      plannerCacheHits: 1,
      plannerCacheMisses: 0,
      topBleed: { key: "tool waste", value: 4, pct: "67%" },
    };
    app.openBudgetView("Budget Inspector", { all: { ...report, sessionCount: 4 }, session: report }, "all");
    app.drawImmediate();
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("Budget Inspector");
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("s current");
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("tab next");
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("all sessions");
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("BUDGET");
    app.handleKey({ name: "s", char: "s", ctrl: false, meta: false, shift: false } as Keypress);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("current session");
    app.handleKey({ name: "tab", char: "", ctrl: false, meta: false, shift: false } as Keypress);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("[Efficiency]");
    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false } as Keypress);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).not.toContain("Budget Inspector");
  });

  it("uses the alternate screen for model picker overlays", () => {
    const app = new App() as any;
    app.screen = {
      height: 14,
      width: 60,
      hasSidebar: true,
      mainWidth: 38,
      sidebarWidth: 19,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.openModelPicker([
      { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6", active: false },
      { providerId: "ollama", providerName: "Ollama", modelId: "gemma3:4b", active: false },
    ], () => {});
    app.drawImmediate();
    expect(app.modelPicker).not.toBeNull();
    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false } as Keypress);
    expect(app.modelPicker).toBeNull();
  });
});

describe("session tree", () => {
  it("opens as a bottom modal instead of taking over the full screen", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 12, width: 60, hasSidebar: true, mainWidth: 38, sidebarWidth: 19, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    const session = new Session(`test-tree-overlay-${Date.now()}`);
    session.addMessage("user", "Review the failing tests in session-manager");
    session.addMessage("assistant", "The regression is in continueRecent.");
    app.openTreeView("Session Tree", session, () => {});
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Session Tree");
    expect(output).toContain("/tree");
    expect(output).toContain("shift+l label");
    expect(output).toContain("Review the failing t");
    expect(output).toContain("continueRecent");
  });
});

describe("theme rendering", () => {
  it("keeps markdown rendering bound to the active palette and plan mode tint", () => {
    const previousMode = getSettings().mode;
    try {
      updateSetting("mode", "plan");
      const lines = renderStaticMessages({
        messages: [{ role: "assistant", content: "Plain assistant text" }],
        maxWidth: 40,
        toolOutputCollapsed: false,
        isToolOutput: () => false,
        wordWrap,
        colors: { imageTagBg: "", userBg: "", userText: "", userAccent: "", border: "", muted: currentTheme().textMuted, text: currentTheme().text },
        reset: "\u001b[0m",
        bold: "\u001b[1m",
      });
      expect(lines.join("\n")).toContain(currentTheme().text);
      expect(currentTheme().plan).toBe(currentTheme().primary);
    } finally {
      updateSetting("mode", previousMode);
    }
  });
});
