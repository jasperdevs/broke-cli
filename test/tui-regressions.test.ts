import { describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";
import { App } from "../src/tui/app.js";
import { renderStaticMessages } from "../src/tui/render/messages.js";
import { wordWrap } from "../src/tui/render/formatting.js";
import { MOUSE_OFF, MOUSE_ON } from "../src/utils/ansi.js";
import { currentTheme, getPlanColor, listThemes, setPreviewTheme } from "../src/core/themes.js";
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
      colors: {
        imageTagBg: "",
        userBg: "",
        userText: "",
        border: "",
        muted: "",
        text: "",
      },
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

    expect(app.renderTokenSummaryParts()).toEqual([
      "↑ 150 in",
      "↓ 60 out",
      "Σ 210 session",
    ]);
  });

  it("shows the lifetime total line in the sidebar footer", () => {
    const app = new App() as any;
    app.setContextUsage(132, 344_000);
    app.updateUsage(0.0016, 150, 60);

    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
    expect(footer).toContain("↑ 150 in");
    expect(footer).toContain("↓ 60 out");
    expect(footer).toContain("Σ 210 session");
  });

  it("uses the rock indicator and wraps cost/context details instead of clipping", () => {
    const app = new App() as any;
    app.screen = {
      sidebarWidth: 12,
      width: 80,
      height: 24,
      hasSidebar: true,
      mainWidth: 61,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    updateSetting("cavemanLevel", "ultra");
    app.setContextUsage(132_000, 344_000);
    app.updateUsage(0.0016, 150, 60);

    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line));
    expect(footer.some((line: string) => line.includes("🪨 ultra"))).toBe(true);
    expect(footer[0]).toBe("");
    expect(footer.some((line: string) => line.includes("Session"))).toBe(true);
    expect(footer.some((line: string) => line.trim() === "$0.0016")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "Σ 210 session")).toBe(true);
    expect(footer.some((line: string) => line.includes("Context"))).toBe(true);
    expect(footer.some((line: string) => line.trim() === "132k/344k")).toBe(true);
    expect(footer.some((line: string) => line.trim() === "38% of limit")).toBe(true);
    expect(footer.findIndex((line: string) => line.includes("Context"))).toBeGreaterThan(
      footer.findIndex((line: string) => line.includes("Σ 210 session")),
    );

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
});

describe("startup home view", () => {
  it("starts without the sidebar and keeps recent sessions compact", () => {
    const app = new App() as any;
    app.providerName = "openai";
    app.modelName = "gpt-5.4-mini";
    app.appVersion = "1.2.3";
    app.cwd = "C:\\Users\\bunny\\Downloads\\broke-cli";
    app.homeTip = "Use /resume to jump back in without wasting time on manual session hunting.";
    app.homeRecentSessions = [
      {
        id: "abc123",
        cwd: "C:\\Users\\bunny\\Downloads\\broke-cli",
        model: "anthropic/claude-sonnet",
        cost: 0.0012,
        updatedAt: Date.now() - 60_000,
        messageCount: 4,
      },
    ];

    let rendered: string[] = [];
    app.screen = {
      height: 20,
      width: 100,
      hasSidebar: true,
      mainWidth: 73,
      sidebarWidth: 24,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.drawImmediate();

    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    const firstCardLine = rendered.find((line) => stripAnsi(line).includes("╭")) ?? "";
    expect(stripAnsi(firstCardLine)).toContain("╭");
    expect(stripAnsi(firstCardLine)).not.toContain("BrokeCLI Home");
    expect(output).toContain("Welcome to BrokeCLI");
    expect(output).toContain("openai/gpt-5.4-mini");
    expect(output).toContain("~\\Downloads\\broke-cli");
    expect(output).toContain("Tip");
    expect(output).not.toContain("Files");
    expect(output).not.toContain("Recent Sessions");
    expect(output).not.toContain("anthropic/claude-sonnet");
  });

  it("only enables the sidebar after chat starts", () => {
    const app = new App() as any;
    let rendered: string[] = [];

    app.screen = {
      height: 18,
      width: 100,
      hasSidebar: true,
      mainWidth: 73,
      sidebarWidth: 24,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.drawImmediate();
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).not.toContain("Files");

    app.messages = [{ role: "user", content: "hello" }];
    app.drawImmediate();
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("Files");
  });

  it("drops the startup card entirely on very narrow widths", () => {
    const app = new App() as any;
    let rendered: string[] = [];

    app.screen = {
      height: 18,
      width: 20,
      hasSidebar: false,
      mainWidth: 20,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.drawImmediate();

    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).not.toContain("Welcome");
    expect(output).not.toContain("▀");
    expect(output).not.toContain("█");
  });

  it("hides the startup card entirely in cramped panes so it does not leak into the input area", () => {
    const app = new App() as any;
    let rendered: string[] = [];

    app.screen = {
      height: 8,
      width: 20,
      hasSidebar: false,
      mainWidth: 20,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

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
    expect(app.getFilteredSettings().map((entry: any) => entry.key)).toEqual(["autoSaveSessions", "showTokens"]);

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

    app.handleKey({ name: "l", char: "l", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "i", char: "i", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "g", char: "g", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "h", char: "h", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "t", char: "t", ctrl: false, meta: false, shift: false });

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
      expect(getSettings().mode).toBe("build");
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
        colors: {
          imageTagBg: "",
          userBg: "",
          userText: "",
          border: "",
          muted: currentTheme().textMuted,
          text: currentTheme().text,
        },
        reset: "\u001b[0m",
        bold: "\u001b[1m",
      });

      expect(lines.join("\n")).toContain(currentTheme().text);
    } finally {
      setPreviewTheme(null);
    }
  });
});

describe("command aliases", () => {
  it("suggests theme from the slash-command surface", () => {
    const app = new App() as any;
    app.input.paste("/the");

    const matches = app.getCommandMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe("theme");
  });

  it("suggests clear for the new alias", () => {
    const app = new App() as any;
    app.input.paste("/new");

    const matches = app.getCommandMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe("clear");
  });

  it("suggests resume for the sessions alias and hides reload/cost from the surface", () => {
    const app = new App() as any;
    app.input.paste("/sessions");

    const matches = app.getCommandMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe("resume");

    app.input.clear();
    app.input.paste("/");
    const all = app.getCommandMatches().map((entry: { name: string }) => entry.name);
    expect(all).not.toContain("reload");
    expect(all).not.toContain("cost");
    expect(all).not.toContain("notify");
    expect(all).not.toContain("btw");
    expect(all).toContain("thinking");
  });

  it("keeps settings pinned first in the slash-command surface", () => {
    const app = new App() as any;
    app.input.paste("/");

    const matches = app.getCommandMatches();
    expect(matches[0].name).toBe("settings");
  });

  it("shows hotkeys inline for slash commands that have them", () => {
    const app = new App() as any;
    app.input.paste("/");

    const entries = app.getCommandSuggestionEntries().map((entry: { text: string }) => stripAnsi(entry.text));
    expect(entries.some((entry: string) => entry.includes("model") && entry.includes("ctrl+l"))).toBe(true);
    expect(entries.some((entry: string) => entry.includes("thinking") && entry.includes("ctrl+t"))).toBe(true);
    expect(entries.some((entry: string) => entry.includes("caveman") && entry.includes("ctrl+y"))).toBe(true);
  });
});

describe("sidebar scrolling", () => {
  it("enables mouse handling when the chat sidebar is visible", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.screen = {
      height: 18,
      width: 100,
      hasSidebar: true,
      mainWidth: 73,
      sidebarWidth: 24,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    expect(app.shouldEnableMenuMouse()).toBe(true);
  });

  it("lets sidebar triangle clicks expand directories", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.screen = {
      height: 18,
      width: 100,
      hasSidebar: true,
      mainWidth: 73,
      sidebarWidth: 24,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.sidebarTreeOpen = true;
    app.sidebarFileTree = [
      { name: "src", isDir: true, children: ["app.ts"], depth: 0 },
    ];

    const sidebarLines = app.renderSidebar(app.getChatHeight()).map((line: string) => stripAnsi(line));
    const row = sidebarLines.findIndex((line: string) => line.includes("▸ src/"));
    expect(row).toBeGreaterThanOrEqual(0);

    app.handleKey({ name: "click", char: `${app.screen.mainWidth + 2},${row + 1}`, ctrl: false, meta: false, shift: false });

    expect(app.sidebarExpandedDirs.has("src")).toBe(true);
  });

  it("keeps long file trees scrollable", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hi" }];
    app.sidebarTreeOpen = true;
    app.sidebarFocused = true;
    app.sidebarFileTree = [
      {
        name: "src",
        isDir: true,
        children: Array.from({ length: 12 }, (_, i) => `file-${i}.ts`),
        depth: 0,
      },
    ];
    app.sidebarExpandedDirs.add("src");
    app.sidebarExpandedDirs.add("src:all");

    const before = app.renderSidebar(12).map((line: string) => stripAnsi(line));
    app.scrollSidebar(4, 12);
    const after = app.renderSidebar(12).map((line: string) => stripAnsi(line));

    expect(before.join("\n")).toContain("src/");
    expect(after[0]).toContain("^ more");
    expect(after.join("\n")).toContain("file-");
  });

  it("uses unicode disclosure triangles for the file tree", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hi" }];
    app.sidebarTreeOpen = true;
    app.sidebarFileTree = [
      { name: "src", isDir: true, children: ["app.ts"], depth: 0 },
    ];
    app.sidebarExpandedDirs.add("src");

    const lines = app.buildSidebarLines().map((line: string) => stripAnsi(line));
    expect(lines).toContain("▾ Files");
    expect(lines).toContain("  ▾ src/");
  });

  it("mouse-wheel scrolls chat history when no menu is active", () => {
    const app = new App() as any;
    app.messages = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `msg ${i}` }));
    app.scrollOffset = 6;
    app.screen = {
      height: 16,
      width: 80,
      hasSidebar: false,
      mainWidth: 80,
      sidebarWidth: 20,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.handleKey({ name: "scrolldown", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBe(9);

    app.handleKey({ name: "scrollup", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBe(6);
  });

  it("still allows explicit keyboard paging to move transcript history", () => {
    const app = new App() as any;
    app.messages = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `msg ${i}` }));
    app.scrollOffset = 6;
    app.screen = {
      height: 16,
      width: 80,
      hasSidebar: false,
      mainWidth: 80,
      sidebarWidth: 20,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.handleKey({ name: "pageup", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBe(3);

    app.handleKey({ name: "pagedown", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBe(6);
  });

  it("prioritizes sidebar scrolling over active menus when the sidebar is focused", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.sidebarFocused = true;
    app.screen = {
      height: 18,
      width: 100,
      hasSidebar: true,
      mainWidth: 73,
      sidebarWidth: 24,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.sidebarTreeOpen = true;
    app.sidebarFileTree = [
      { name: "src", isDir: true, children: Array.from({ length: 12 }, (_, i) => `file-${i}.ts`), depth: 0 },
    ];
    app.sidebarExpandedDirs.add("src");
    app.sidebarExpandedDirs.add("src:all");
    app.openItemPicker("Theme", listThemes().slice(0, 5).map((theme) => ({ id: theme.key, label: theme.label })), () => {});

    app.handleKey({ name: "scrolldown", char: "", ctrl: false, meta: false, shift: false });

    expect(app.sidebarScrollOffset).toBeGreaterThan(0);
    expect(app.itemPicker.cursor).toBe(0);
  });

  it("uses the plan accent for footer status when shift+tab toggles plan mode", () => {
    const app = new App() as any;
    app.screen = {
      sidebarWidth: 24,
      width: 100,
      height: 24,
      hasSidebar: true,
      mainWidth: 73,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.handleKey({ name: "tab", char: "", ctrl: false, meta: false, shift: true });
    const footer = app.renderSidebarFooter();

    expect(stripAnsi(footer[1] ?? "")).toContain("plan");
    expect(footer[1]).toContain(getPlanColor());
  });
});

describe("wrapped input layout", () => {
  it("wraps long input lines and tracks cursor row/column", () => {
    const app = new App() as any;
    const layout = app.getInputCursorLayout("one two three four five", 23, 16);

    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.row).toBeGreaterThan(0);
    expect(layout.col).toBeGreaterThanOrEqual(0);
  });

  it("renders the input without the old left gutter", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.input.paste("test");

    let rendered: string[] = [];
    app.screen = {
      height: 12,
      width: 40,
      hasSidebar: false,
      mainWidth: 40,
      sidebarWidth: 20,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.drawImmediate();

    const inputLine = rendered.find((line) => stripAnsi(line).trimEnd() === "test");
    expect(inputLine).toBeTruthy();
    expect(stripAnsi(inputLine!).trimEnd()).toBe("test");
  });

  it("expands the bottom layout for wrapped question prompt input", () => {
    const app = new App() as any;
    app.questionPrompt = {
      question: "Base URL",
      cursor: 0,
      textInput: "http://127.0.0.1:8080/v1/chat/completions/really/long/path",
      resolve: () => {},
    };

    const count = app.getBottomLineCount(20, 20);
    expect(count).toBeGreaterThan(6);
  });

  it("keeps the cursor on the real input row when the sidebar footer is taller than the prompt area", () => {
    const app = new App() as any;
    const settings = getSettings();
    const original = {
      showTokens: settings.showTokens,
      showCost: settings.showCost,
      thinkingLevel: settings.thinkingLevel,
      cavemanLevel: settings.cavemanLevel,
    };

    try {
      updateSetting("showTokens", true);
      updateSetting("showCost", true);
      updateSetting("thinkingLevel", "low");
      updateSetting("cavemanLevel", "ultra");
      app.messages = [{ role: "user", content: "hello" }];
      app.setContextUsage(120_000, 128_000);
      app.updateUsage(0.0021, 8_200, 621);

      let cursorRow = 0;
      let rendered: string[] = [];
      app.screen = {
        height: 12,
        width: 60,
        hasSidebar: true,
        mainWidth: 37,
        sidebarWidth: 22,
        render: (lines: string[]) => { rendered = lines; },
        setCursor: (row: number) => { cursorRow = row; },
        hideCursor: () => {},
        forceRedraw: () => {},
      };

      app.drawImmediate();

      const rowText = stripAnsi(rendered[cursorRow - 1] ?? "");
      expect(rowText).not.toMatch(/^─+$/);
      expect(cursorRow).toBeGreaterThanOrEqual(rendered.length - 2);
      expect(stripAnsi(rendered[Math.max(0, cursorRow - 2)] ?? "").trimStart().startsWith("─")).toBe(true);
    } finally {
      updateSetting("showTokens", original.showTokens);
      updateSetting("showCost", original.showCost);
      updateSetting("thinkingLevel", original.thinkingLevel);
      updateSetting("cavemanLevel", original.cavemanLevel ?? "off");
    }
  });
});

describe("picker menus", () => {
  it("scrolls through long file menus with the mouse wheel", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.filePicker = {
      files: Array.from({ length: 20 }, (_, i) => `src/file-${i}.ts`),
      filtered: Array.from({ length: 20 }, (_, i) => `src/file-${i}.ts`),
      query: "",
      cursor: 0,
    };

    let rendered: string[] = [];
    app.screen = {
      height: 16,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 20,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.drawImmediate();
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("src/file-0.ts");

    for (let i = 0; i < 8; i++) {
      app.handleKey({ name: "scrolldown", char: "", ctrl: false, meta: false, shift: false });
    }
    app.drawImmediate();

    expect(app.filePicker.cursor).toBe(8);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("src/file-8.ts");
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).not.toContain("src/file-0.ts");
  });

  it("lets visible picker rows be selected with a click", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];

    const selected: string[] = [];
    app.openItemPicker(
      "Pick one",
      [
        { id: "one", label: "First" },
        { id: "two", label: "Second" },
        { id: "three", label: "Third" },
      ],
      (id: string) => selected.push(id),
    );

    let rendered: string[] = [];
    app.screen = {
      height: 16,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 20,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.drawImmediate();
    const row = rendered.findIndex((line) => stripAnsi(line).includes("Second"));
    expect(row).toBeGreaterThanOrEqual(0);

    app.handleKey({ name: "click", char: `5,${row + 1}`, ctrl: false, meta: false, shift: false });

    expect(selected).toEqual(["two"]);
    expect(app.itemPicker).toBeNull();
  });

  it("shows a model scope toggle and lets tab switch between all and scoped", () => {
    const app = new App() as any;
    app.openModelPicker(
      [
        { providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", active: true },
        { providerId: "openai", providerName: "OpenAI", modelId: "gpt-4o", active: false },
      ],
      () => {},
      () => {},
    );

    expect(app.getFilteredModels().map((entry: { modelId: string }) => entry.modelId)).toEqual(["gpt-5.4-mini", "gpt-4o"]);

    app.handleKey({ name: "tab", char: "", ctrl: false, meta: false, shift: false });

    expect(app.modelPicker.scope).toBe("scoped");
    expect(app.getFilteredModels().map((entry: { modelId: string }) => entry.modelId)).toEqual(["gpt-5.4-mini"]);

    let rendered: string[] = [];
    app.screen = {
      height: 16,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 20,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.drawImmediate();

    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Scope: all | scoped");
    expect(output).not.toContain("tab scope");
  });

  it("previews highlighted themes and restores the previous theme on escape", () => {
    const app = new App() as any;
    const originalTheme = getSettings().theme;
    const themes = listThemes().slice(0, 4);
    const previousTheme = themes[0].key;
    const previewCursor = 1;

    try {
      updateSetting("theme", previousTheme);
      app.openItemPicker(
        "Theme",
        themes.map((theme) => ({ id: theme.key, label: theme.label })),
        () => {},
        {
          initialCursor: 0,
          onPreview: (themeId: string) => setPreviewTheme(themeId),
          onCancel: () => setPreviewTheme(null),
        },
      );

      while (app.itemPicker.cursor < previewCursor) {
        app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
      }
      expect(currentTheme().key).toBe(themes[previewCursor].key);
      expect(getSettings().theme).toBe(previousTheme);

      app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
      expect(currentTheme().key).toBe(previousTheme);
      expect(getSettings().theme).toBe(previousTheme);
      expect(app.itemPicker).toBeNull();
    } finally {
      setPreviewTheme(null);
      updateSetting("theme", originalTheme);
    }
  });

});

describe("thinking preview", () => {
  it("shows thinking immediately when requested even before reasoning text arrives", () => {
    const app = new App() as any;

    app.setStreaming(true);
    app.setThinkingRequested(true);

    const output = app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("Thinking...");
    expect(output).toContain("waiting for model reasoning");

    app.setStreaming(false);
  });

  it("persists the last thought block until the next user turn", () => {
    const app = new App() as any;

    app.setStreaming(true);
    app.appendThinking("first pass");
    app.setStreaming(false);

    expect(app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n")).toContain("Reasoned");

    app.addMessage("user", "next");
    expect(app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n")).not.toContain("thought");
  });
});

describe("theme catalog", () => {
  it("keeps BrokeCLI dark and light at the top of the picker", () => {
    const themes = listThemes();
    expect(themes[0]?.key).toBe("brokecli-dark");
    expect(themes[1]?.key).toBe("brokecli-light");
    expect(themes.length).toBeGreaterThan(10);
  });

  it("applies the active theme background across rendered rows", () => {
    const app = new App() as any;
    const previousTheme = getSettings().theme;
    let rendered: string[] = [];

    try {
      updateSetting("theme", "brokecli-light");
      app.messages = [{ role: "user", content: "hello" }];
      app.input.paste("test");
      app.screen = {
        height: 12,
        width: 40,
        hasSidebar: false,
        mainWidth: 40,
        sidebarWidth: 20,
        render: (lines: string[]) => { rendered = lines; },
        setCursor: () => {},
        hideCursor: () => {},
        forceRedraw: () => {},
      };

      app.drawImmediate();

      expect(rendered[0]).toContain(currentTheme().background);
    } finally {
      updateSetting("theme", previousTheme);
    }
  });

  it("keeps BrokeCLI Dark on the terminal background", () => {
    const originalTheme = getSettings().theme;
    try {
      updateSetting("theme", "brokecli-dark");
      setPreviewTheme(null);
      expect(currentTheme().background).toBe("");
    } finally {
      updateSetting("theme", originalTheme);
    }
  });
});

describe("interrupt prompts", () => {
  it("primes escape before aborting a stream", () => {
    const app = new App() as any;
    let aborted = 0;
    app.setStreaming(true);
    app.onAbort = () => { aborted++; };

    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
    expect(app.escPrimed).toBe(true);
    expect(aborted).toBe(0);

    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
    expect(aborted).toBe(1);
    expect(app.escPrimed).toBe(false);
  });

  it("shows inline ctrl+c exit prompt without using the extra status line", () => {
    const app = new App() as any;
    app.handleKey({ name: "c", char: "\u0003", ctrl: true, meta: false, shift: false });

    expect(app.ctrlCCount).toBe(1);
    expect(app.statusMessage).toBeUndefined();
  });
});
