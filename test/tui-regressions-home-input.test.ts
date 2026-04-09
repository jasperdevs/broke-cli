import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";
import { buildBudgetReport } from "../src/core/budget-insights.js";
import { Session } from "../src/core/session.js";
import { currentTheme } from "../src/core/themes.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import type { Keypress } from "../src/tui/keypress.js";
import { getCommandMatches } from "../src/tui/command-surface.js";

describe("theme-derived panels", () => {
  it("keeps the sidebar panel background distinct from the main app background", () => {
    const theme = currentTheme();
    expect(theme.sidebarBackground).toBeTruthy();
    expect(theme.sidebarBackground).not.toBe(theme.background);
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
    expect(output).toContain("GPT-5.4 mini");
    expect(output).toContain("~\\Downloads\\broke-cli");
    expect(output).toContain("Status");
    expect(output).toContain("/resume");
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
    const originalHideSidebar = getSettings().hideSidebar;
    updateSetting("hideSidebar", false);
    try {
      const app = new App() as any;
      let rendered: string[] = [];
      app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
      app.drawImmediate();
      expect(rendered.map((line) => stripAnsi(line)).join("\n")).not.toContain("Files");
      app.messages = [{ role: "user", content: "hello" }];
      app.drawImmediate();
      const output = rendered.map((line) => stripAnsi(line)).join("\n");
      expect(output).toContain("Current model");
      expect(output).not.toContain("Mode");
      expect(output).toContain("Role models");
    } finally {
      updateSetting("hideSidebar", originalHideSidebar);
    }
  });

  it("falls back to a compact startup card on very narrow widths", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 18, width: 20, hasSidebar: false, mainWidth: 20, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Welcome");
    expect(output).toContain("Model");
    expect(output).not.toContain("▀");
    expect(output).not.toContain("█");
  });

  it("keeps a compact startup card in cramped panes without leaking into the input area", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 8, width: 20, hasSidebar: false, mainWidth: 20, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.input.paste("hey");
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Welcome");
    expect(output).toContain("hey");
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
    app.openItemPicker("Projects", [
      { id: "alpha", label: "Alpha Project", detail: "main app shell" },
      { id: "lightbox", label: "Lightbox", detail: "asset browser" },
    ], () => {}, { kind: "projects" });
    expect(app.input.getText()).toBe("/projects ");
    for (const char of "light") app.handleKey({ name: char, char, ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("/projects light");
    expect(app.getFilteredItems().map((item: any) => item.id)).toEqual(["lightbox"]);
    for (let i = 0; i < "light".length; i++) app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("/projects ");
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
    expect(inputIndex - queueIndex).toBeLessThanOrEqual(5);
  });

  it("keeps shift-enter as a newline even when slash suggestions are visible", () => {
    const app = new App() as any;
    app.input.paste("/");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: true });
    expect(app.input.getText()).toBe("/\n");
  });

  it("hides global slash suggestions once command arguments begin", () => {
    expect(getCommandMatches("/bt")).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "btw" })]),
    );
    expect(getCommandMatches("/set")).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "settings" })]),
    );
    expect(getCommandMatches("/btw hey")).toEqual([]);
    expect(getCommandMatches("/model haiku")).toEqual([]);
  });

  it("promotes /set to /settings on enter instead of submitting raw chat text", () => {
    const app = new App() as any;
    let submitted = "";
    app.onSubmit = (text: string) => { submitted = text; };
    app.input.setText("/set");

    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });

    expect(submitted).toBe("/settings");
  });

  it("canonicalizes a slash alias when space starts the command arguments", () => {
    const app = new App() as any;
    app.input.setText("/set");

    app.handleKey({ name: "space", char: " ", ctrl: false, meta: false, shift: false });

    expect(app.input.getText()).toBe("/settings ");
  });

  it("canonicalizes unique slash prefixes on submit before sending chat text", () => {
    const app = new App() as any;
    let submitted = "";
    app.onSubmit = (text: string) => { submitted = text; };
    app.input.setText("/budg");

    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });

    expect(submitted).toBe("/budget");
  });

  it("treats kitty esc-enter as a newline instead of meta-enter submit", () => {
    const app = new App() as any;
    app.input.paste("hello");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: true });
    expect(app.input.getText()).toBe("hello\n");
  });

  it("renders a /btw bubble above the input and dismisses it from the keyboard", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 18, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.openBtwBubble({ question: "what changed?", answer: "footer spacing", modelLabel: "Claude Sonnet 4.6", pending: false });
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("/btw");
    expect(output).toContain("what changed?");
    expect(output).toContain("footer spacing");
    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
    expect(app.btwBubble).toBeNull();
  });

  it("keeps shift-enter as a newline while a /btw bubble is visible", () => {
    const app = new App() as any;
    app.openBtwBubble({ question: "status?", answer: "", modelLabel: "Claude Sonnet 4.6", pending: true });
    app.input.paste("line one");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: true });
    expect(app.input.getText()).toBe("line one\n");
  });

  it("renders a live pending shimmer state for /btw bubbles", () => {
    const app = new App() as any;
    app.openBtwBubble({ question: "status?", answer: "", modelLabel: "Claude Sonnet 4.6", pending: true });
    const output = app.renderBtwBubble(60).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("/btw");
    expect(output).toContain("status?");
    expect(output).toContain("Answering from current session context...");
    expect(output).toContain("esc cancel");
  });

  it("runs /btw immediately instead of queueing it while the main stream is active", () => {
    const app = new App() as any;
    let submitted: { text: string; images?: Array<{ mimeType: string; data: string }> } | null = null;
    app.isStreaming = true;
    app.onSubmit = (text: string, images?: Array<{ mimeType: string; data: string }>) => {
      submitted = { text, images };
    };
    app.input.paste("/btw status?");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });
    expect(submitted).toEqual({ text: "/btw status?", images: undefined });
    expect(app.pendingMessages).toEqual([]);
  });

  it("runs /settings immediately instead of queueing it while the main stream is active", () => {
    const app = new App() as any;
    let submitted = "";
    app.isStreaming = true;
    app.onSubmit = (text: string) => {
      submitted = text;
    };
    app.input.paste("/settings");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });
    expect(submitted).toBe("/settings");
    expect(app.pendingMessages).toEqual([]);
  });

  it("runs all slash commands immediately instead of queueing them while the main stream is active", () => {
    const app = new App() as any;
    let submitted = "";
    app.isStreaming = true;
    app.onSubmit = (text: string) => {
      submitted = text;
    };
    app.input.paste("/model");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });
    expect(submitted).toBe("/model");
    expect(app.pendingMessages).toEqual([]);
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

  it("shows a tab-to-queue hint while typing during a running turn", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.messages = [{ role: "assistant", content: "working" }];
    app.isStreaming = true;
    app.streamStartTime = Date.now() - 1000;
    app.input.paste("f");
    app.screen = { height: 12, width: 40, hasSidebar: false, mainWidth: 40, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("tab to queue message");
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

  it("clears queued messages when opening settings", () => {
    const app = new App() as any;
    app.addPendingMessage("/", [], "steering");
    app.addPendingMessage("/", [], "followup");
    app.openSettings([
      { key: "showTokens", label: "Show tokens", value: "true", description: "Show token counts" },
    ], () => {});
    expect(app.pendingMessages).toEqual([]);
  });

  it("renders selected file context as plain text in the composer", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.fileContexts.set("src/index.ts", "export {}");
    app.input.setText("check src/index.ts ");
    app.screen = { height: 18, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("src/index.ts");
    expect(output).not.toContain("@src/index.ts");
  });

  it("removes stale file context when the plain path text is gone", () => {
    const app = new App() as any;
    app.fileContexts.set("src/one.ts", "1");
    app.fileContexts.set("src/two.ts", "2");
    app.input.setText("src/one.ts ");
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(Array.from(app.fileContexts.keys())).toEqual(["src/one.ts"]);
  });

  it("closes the file picker once the @ mention token is deleted", () => {
    const app = new App() as any;
    app.projectFiles = ["AGENTS.md", "README.md"];
    app.filePicker = { files: app.projectFiles, filtered: app.projectFiles, query: "AG", cursor: 0 };
    app.input.setText("hey @AG");
    app.input.setCursor("hey @AG".length);

    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });

    expect(app.filePicker).toBeNull();
    expect(app.input.getText()).toBe("hey ");
  });

  it("does not trap left/right navigation while the file picker is open", () => {
    const app = new App() as any;
    app.projectFiles = ["AGENTS.md", "README.md"];
    app.filePicker = { files: app.projectFiles, filtered: app.projectFiles, query: "AG", cursor: 0 };
    app.input.setText("hey @AG");
    app.input.setCursor("hey @AG".length);

    app.handleKey({ name: "left", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "left", char: "", ctrl: false, meta: false, shift: false });

    expect(app.input.getCursor()).toBe("hey @".length);
    expect(app.filePicker?.query).toBe("");
  });

  it("does not trap backspace when a stale file picker remains open without an active @ token", () => {
    const app = new App() as any;
    app.projectFiles = ["AGENTS.md", "README.md"];
    app.filePicker = { files: app.projectFiles, filtered: app.projectFiles, query: "AG", cursor: 0 };
    app.input.setText("hello ");
    app.input.setCursor("hello ".length);

    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });

    expect(app.filePicker).toBeNull();
    expect(app.input.getText()).toBe("hello");
  });
});
