import { describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";
import { App } from "../src/tui/app.js";
import { renderStaticMessages } from "../src/tui/render/messages.js";
import { wordWrap } from "../src/tui/render/formatting.js";
import { MOUSE_OFF, MOUSE_ON } from "../src/utils/ansi.js";
import { visibleWidth } from "../src/utils/terminal-width.js";
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

  it("does not enable terminal mouse capture even when the sidebar is visible", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    expect(app.shouldEnableMenuMouse()).toBe(false);
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
    const originalShowTokens = getSettings().showTokens;
    updateSetting("showTokens", true);
    const app = new App() as any;
    app.setContextUsage(132, 344_000);
    app.updateUsage(0.0016, 150, 60);
    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
    expect(footer).not.toContain("Session");
    expect(footer).not.toContain("Next request");
    expect(footer).toContain("Σ 210 session");
    expect(footer).toContain("↑ 150 in");
    expect(footer).toContain("↓ 60 out");
    expect(footer).toContain("live 132");
    expect(footer).toContain("<1%");
    expect(footer).toContain("▕");
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
    expect(footer.some((line: string) => line.trim() === "Σ 210 session")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "↑ 150 in")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "↓ 60 out")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "live 132k")).toBe(true);
    expect(footer.some((line: string) => line.includes("38%"))).toBe(true);
    expect(footer.some((line: string) => line.includes("▕"))).toBe(true);
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
    expect(footer).toContain("live 822");
    expect(footer).toContain("<1%");
    expect(footer).toContain("▕");
    updateSetting("showTokens", originalShowTokens);
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

describe("terminal cell width", () => {
  it("pads and decorates frame lines to the exact terminal width even with emoji and ANSI", () => {
    const app = new App() as any;
    const raw = ` ${currentTheme().warning}🪨 ultra${"\x1b[0m"} | ${currentTheme().textMuted}Σ 210 session${"\x1b[0m"}`;
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

describe("budget inspector", () => {
  it("opens as a fullscreen mode and closes with escape", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    const alternateStates: boolean[] = [];
    app.screen = { height: 12, width: 40, hasSidebar: true, mainWidth: 28, sidebarWidth: 11, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {}, setAlternateScreen: (enabled: boolean) => { alternateStates.push(enabled); } };
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
    expect(alternateStates.at(-1)).toBe(true);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("Budget Inspector");
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("tab current");
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("all sessions");
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("BUDGET");
    app.handleKey({ name: "tab", char: "", ctrl: false, meta: false, shift: false } as Keypress);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("current session");
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("tab all");
    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false } as Keypress);
    expect(alternateStates.at(-1)).toBe(false);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).not.toContain("Budget Inspector");
  });

  it("uses the alternate screen for model picker overlays", () => {
    const app = new App() as any;
    const alternateStates: boolean[] = [];
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
      setAlternateScreen: (enabled: boolean) => { alternateStates.push(enabled); },
    };
    app.openModelPicker([
      { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6", active: false },
      { providerId: "ollama", providerName: "Ollama", modelId: "gemma3:4b", active: false },
    ], () => {});
    app.drawImmediate();
    expect(alternateStates.at(-1)).toBe(true);
    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false } as Keypress);
    expect(alternateStates.at(-1)).toBe(false);
  });
});

describe("agent task inspector", () => {
  it("opens as a fullscreen mode with task details", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 12, width: 60, hasSidebar: true, mainWidth: 38, sidebarWidth: 19, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.openAgentRunsView("Agent Tasks", [{
      id: "run-1",
      prompt: "Review the failing tests in session-manager",
      status: "done",
      result: "The regression is in continueRecent.",
      detail: "model openai/gpt-5.4 · tools readFile,grep",
      createdAt: Date.now(),
    }]);
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Agent Tasks");
    expect(output).toContain("esc back");
    expect(output).toContain("Review the failing tests");
    expect(output).toContain("continueRecent");
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
