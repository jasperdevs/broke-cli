import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";
import { listThemes } from "../src/core/themes.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import stripAnsi from "strip-ansi";

describe("command aliases", () => {
  it("suggests theme from the slash-command surface", () => {
    const app = new App() as any;
    app.input.paste("/the");
    expect(app.getCommandMatches()[0].name).toBe("theme");
  });

  it("suggests clear for the new alias", () => {
    const app = new App() as any;
    app.input.paste("/new");
    expect(app.getCommandMatches()[0].name).toBe("clear");
  });

  it("suggests resume for the sessions alias and only shows shipped commands", () => {
    const app = new App() as any;
    app.input.paste("/sessions");
    expect(app.getCommandMatches()[0].name).toBe("resume");
    app.input.clear();
    app.input.paste("/");
    const all = app.getCommandMatches().map((entry: { name: string }) => entry.name);
    expect(all).toContain("reload");
    expect(all).toContain("hotkeys");
    expect(all).toContain("session");
    expect(all).toContain("tree");
    expect(all).not.toContain("cost");
    expect(all).not.toContain("notify");
    expect(all).not.toContain("btw");
    expect(all).toContain("thinking");
  });

  it("keeps settings pinned first and shows hotkeys", () => {
    const app = new App() as any;
    app.input.paste("/");
    expect(app.getCommandMatches()[0].name).toBe("settings");
    const entries = app.getCommandSuggestionEntries().map((entry: { text: string }) => stripAnsi(entry.text));
    expect(entries.some((entry: string) => entry.includes("model") && entry.includes("ctrl+l"))).toBe(true);
    expect(entries.some((entry: string) => entry.includes("thinking") && entry.includes("ctrl+t"))).toBe(true);
    expect(entries.some((entry: string) => entry.includes("caveman") && entry.includes("ctrl+y"))).toBe(true);
  });
});

describe("sidebar scrolling", () => {
  it("enables mouse tracking for split-pane chats so clicks still work with separate panes", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    expect(app.shouldEnableMenuMouse()).toBe(true);
  });

  it("still supports expanding directories through keyboard-driven sidebar state", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.sidebarTreeOpen = true;
    app.sidebarFileTree = [{ name: "src", isDir: true, children: ["app.ts"], depth: 0 }];
    app.sidebarExpandedDirs.add("src");
    expect(app.sidebarExpandedDirs.has("src")).toBe(true);
  });

  it("keeps long file trees scrollable and uses unicode disclosure triangles", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hi" }];
    app.sidebarTreeOpen = true;
    app.sidebarFocused = true;
    app.buildSidebarLines = () => [
      "New Session",
      "v0.0.1",
      "",
      "provider/model",
      "",
      "Directory",
      "  ~/repo",
      "",
      "▾ Files",
      "  ▾ src/",
      ...Array.from({ length: 12 }, (_, i) => `    file-${i}.ts`),
    ];
    const before = app.renderSidebar(12).map((line: string) => stripAnsi(line));
    app.scrollSidebar(4, 12);
    const after = app.renderSidebar(12).map((line: string) => stripAnsi(line));
    expect(before.join("\n")).toContain("src/");
    expect(after[0]).toContain("^ more");
    expect(after.join("\n")).toContain("file-");
    const lines = app.buildSidebarLines().map((line: string) => stripAnsi(line));
    expect(lines).toContain("▾ Files");
    expect(lines).toContain("  ▾ src/");
  });

  it("scrolls transcript outside menus and still keeps the sidebar footer visible during active menus", () => {
    const originalShowTokens = getSettings().showTokens;
    updateSetting("showTokens", true);
    const app = new App() as any;
    app.messages = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `msg ${i}` }));
    app.scrollOffset = 8;
    app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 20, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.handleKey({ name: "scrollup", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "pageup", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBeLessThan(8);

    app.messages = [{ role: "user", content: "hello" }];
    app.sidebarFocused = true;
    app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.sidebarTreeOpen = true;
    app.sidebarFileTree = [{ name: "src", isDir: true, children: Array.from({ length: 12 }, (_, i) => `file-${i}.ts`), depth: 0 }];
    app.sidebarExpandedDirs.add("src");
    app.sidebarExpandedDirs.add("src:all");
    app.openItemPicker("Theme", listThemes().slice(0, 5).map((theme) => ({ id: theme.key, label: theme.label })), () => {});
    app.handleKey({ name: "scrolldown", char: "", ctrl: false, meta: false, shift: false });
    expect(app.sidebarScrollOffset).toBeGreaterThan(0);
    expect(app.itemPicker.cursor).toBe(0);

    app.sidebarFocused = false;
    app.handleKey({ name: "pagedown", char: "", ctrl: false, meta: false, shift: false });
    expect(app.itemPicker.cursor).toBeGreaterThan(0);

    app.mode = "plan";
    app.setContextUsage(120_000, 128_000);
    app.updateUsage(0.0021, 8_200, 621);
    const footerWhileMenuOpen = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
    expect(footerWhileMenuOpen).toContain("8.8k total");
    app.closeItemPicker();
    const footer = app.renderSidebarFooter();
    const footerText = footer.map((line: string) => stripAnsi(line)).join("\n");
    expect(footerText).toContain("8.8k total");
    expect(footerText).toContain("8.2k in");
    expect(footerText).toContain("621 out");
    expect(footerText).toContain("120k ctx");
    expect(footerText).toContain("94%");
    expect(footerText).toContain("▰");
    expect(footerText).not.toContain("plan");
    updateSetting("showTokens", originalShowTokens);
  });

  it("keeps the slash menu and prompt cursor anchored when the sidebar footer is taller", () => {
    const app = new App() as any;
    const settings = getSettings();
    const original = {
      showTokens: settings.showTokens,
      showCost: settings.showCost,
      thinkingLevel: settings.thinkingLevel,
      cavemanLevel: settings.cavemanLevel,
    };
    let rendered: string[] = [];
    let cursorRow = 0;
    try {
      updateSetting("showTokens", true);
      updateSetting("showCost", true);
      updateSetting("thinkingLevel", "low");
      updateSetting("cavemanLevel", "ultra");
      app.messages = [{ role: "user", content: "hello" }];
      app.setContextUsage(120_000, 128_000);
      app.updateUsage(0.0021, 8_200, 621);
      app.input.setText("/");
      app.screen = {
        height: 14,
        width: 80,
        hasSidebar: true,
        mainWidth: 53,
        sidebarWidth: 24,
        render: (lines: string[]) => { rendered = lines; },
        setCursor: (row: number) => { cursorRow = row; },
        hideCursor: () => {},
        forceRedraw: () => {},
      };
      app.drawImmediate();
      const output = rendered.map((line) => stripAnsi(line)).join("\n");
      expect(output).toContain("Commands");
      expect(output).toContain("settings");
      expect(output).not.toContain("help");
      expect(output).toContain("120k ctx");
      expect(output).toContain("621 out");
      expect(stripAnsi(rendered[cursorRow - 1] ?? "")).toContain("/");
    } finally {
      updateSetting("showTokens", original.showTokens);
      updateSetting("showCost", original.showCost);
      updateSetting("thinkingLevel", original.thinkingLevel);
      updateSetting("cavemanLevel", original.cavemanLevel ?? "off");
    }
  });

  it("caps sidebar chat slash menus to five visible command rows", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.messages = [{ role: "user", content: "hello" }];
    app.input.setText("/");
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
    const output = rendered.map((line) => stripAnsi(line));
    const commandRows = output.filter((line) => /\ssettings\s+configure options|\smodel\s+switch model|\sconnect\s+connect provider|\ssession\s+inspect session|\sresume\s+load prior session/.test(line));
    expect(commandRows.length).toBeLessThanOrEqual(5);
  });

  it("keeps the sidebar column visible while slash menus are open in active chats", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.messages = [{ role: "user", content: "hello" }];
    app.setDetectedProviders(["Claude Code", "GitHub Copilot"]);
    app.input.setText("/");
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
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Commands");
    expect(output).toContain("Directory");
    expect(output).toContain("Design/UI");
    expect(output).toContain("same as chat");
  });

  it("scrolls transcript lines with wheel and page keys", () => {
    const app = new App() as any;
    app.messages = Array.from({ length: 40 }, (_, i) => ({ role: "assistant", content: `line ${i}` }));
    app.scrollOffset = 8;
    app.screen = { height: 16, width: 70, hasSidebar: false, mainWidth: 70, sidebarWidth: 20, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.handleKey({ name: "scrollup", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "pageup", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBeLessThan(8);
  });

  it("scrolls the sidebar when wheel coordinates land in the sidebar even without prior focus", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.sidebarTreeOpen = true;
    app.buildSidebarLines = () => [
      "New Session",
      "v0.0.1",
      "",
      "provider/model",
      "",
      "Directory",
      "  ~/repo",
      "",
      "▾ Files",
      "  ▾ src/",
      ...Array.from({ length: 18 }, (_, i) => `    file-${i}.ts`),
    ];

    expect(app.sidebarScrollOffset).toBe(0);
    app.handleKey({ name: "scrolldown", char: "95,8", ctrl: false, meta: false, shift: false });
    expect(app.sidebarFocused).toBe(true);
    expect(app.sidebarScrollOffset).toBeGreaterThan(0);
  });

  it("routes wheel-style sidebar packets to sidebar scrolling even when terminals set modifier bits", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.buildSidebarLines = () => [
      "New Session",
      "v0.0.1",
      "",
      "provider/model",
      "",
      "Directory",
      "  ~/repo",
      "",
      "▾ Files",
      "  ▾ src/",
      ...Array.from({ length: 18 }, (_, i) => `    file-${i}.ts`),
    ];
    app.handleKey({ name: "scrolldown", char: "95,8", ctrl: false, meta: false, shift: false });
    expect(app.sidebarScrollOffset).toBeGreaterThan(0);
  });

  it("keeps the sidebar footer visible while composing plain text but hides it while streaming", () => {
    const app = new App() as any;
    const originalShowTokens = getSettings().showTokens;
    updateSetting("showTokens", true);
    try {
      app.messages = [{ role: "assistant", content: "working" }];
      app.setContextUsage(120_000, 128_000);
      app.updateUsage(0.0021, 8_200, 621);
      app.input.setText("hi");
      const footerWhileTyping = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
      expect(footerWhileTyping).toContain("8.8k total");
      expect(footerWhileTyping).toContain("120k ctx");

      app.input.clear();
      app.setStreaming(true);
      expect(app.renderSidebarFooter()).toEqual([]);
      if (app.spinnerTimer) clearInterval(app.spinnerTimer);
    } finally {
      updateSetting("showTokens", originalShowTokens);
    }
  });
});

describe("wrapped input layout", () => {
  it("wraps long input lines and tracks cursor row/column", () => {
    const app = new App() as any;
    const layout = app.getInputCursorLayout("one two three four five", 23, 16);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.row).toBeGreaterThan(0);
  });

  it("renders the input with a visible prompt marker and reuses the bottom overlay for question prompts", async () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.input.paste("test");
    let rendered: string[] = [];
    app.screen = { height: 12, width: 40, hasSidebar: false, mainWidth: 40, sidebarWidth: 20, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const inputLine = rendered.find((line) => stripAnsi(line).trimEnd() === "> test");
    expect(stripAnsi(inputLine!).trimEnd()).toBe("> test");
    const before = app.getBottomLineCount(20, 20);
    const pending = app.showQuestion("Base URL");
    app.drawImmediate();
    expect(app.getBottomLineCount(20, 20)).toBeGreaterThan(before);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("Base URL");
    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
    await expect(pending).resolves.toBe("[user skipped]");
  });

  it("renders an explicit prompt marker and offset cursor in fullscreen sidebar chat mode", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    let cursorCol = 0;
    app.messages = [{ role: "user", content: "hello" }];
    app.screen = {
      height: 18,
      width: 100,
      hasSidebar: true,
      mainWidth: 73,
      sidebarWidth: 24,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: (_row: number, col: number) => { cursorCol = col; },
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line));
    expect(output.some((line) => line.startsWith("> "))).toBe(true);
    expect(cursorCol).toBeGreaterThanOrEqual(3);
  });

  it("keeps the cursor on the real input row when the sidebar footer is taller than the prompt area", () => {
    const app = new App() as any;
    const settings = getSettings();
    const original = { showTokens: settings.showTokens, showCost: settings.showCost, thinkingLevel: settings.thinkingLevel, cavemanLevel: settings.cavemanLevel };
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
      app.screen = { height: 12, width: 60, hasSidebar: true, mainWidth: 37, sidebarWidth: 22, render: (lines: string[]) => { rendered = lines; }, setCursor: (row: number) => { cursorRow = row; }, hideCursor: () => {}, forceRedraw: () => {} };
      app.drawImmediate();
      const rowText = stripAnsi(rendered[cursorRow - 1] ?? "");
      expect(rowText).not.toMatch(/^─+$/);
      expect(cursorRow).toBeGreaterThanOrEqual(rendered.length - 3);
    } finally {
      updateSetting("showTokens", original.showTokens);
      updateSetting("showCost", original.showCost);
      updateSetting("thinkingLevel", original.thinkingLevel);
      updateSetting("cavemanLevel", original.cavemanLevel ?? "off");
    }
  });
});
