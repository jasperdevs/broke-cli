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

  it("suggests resume for the sessions alias and hides removed commands", () => {
    const app = new App() as any;
    app.input.paste("/sessions");
    expect(app.getCommandMatches()[0].name).toBe("resume");
    app.input.clear();
    app.input.paste("/");
    const all = app.getCommandMatches().map((entry: { name: string }) => entry.name);
    expect(all).not.toContain("reload");
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
  it("enables mouse handling when the chat sidebar is visible", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    expect(app.shouldEnableMenuMouse()).toBe(true);
  });

  it("lets sidebar triangle clicks expand directories", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.sidebarTreeOpen = true;
    app.sidebarFileTree = [{ name: "src", isDir: true, children: ["app.ts"], depth: 0 }];
    const row = app.renderSidebar(app.getChatHeight()).map((line: string) => stripAnsi(line)).findIndex((line: string) => line.includes("▸ src/"));
    app.handleKey({ name: "click", char: `${app.screen.mainWidth + 2},${row + 1}`, ctrl: false, meta: false, shift: false });
    expect(app.sidebarExpandedDirs.has("src")).toBe(true);
  });

  it("keeps long file trees scrollable and uses unicode disclosure triangles", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hi" }];
    app.sidebarTreeOpen = true;
    app.sidebarFocused = true;
    app.sidebarFileTree = [{ name: "src", isDir: true, children: Array.from({ length: 12 }, (_, i) => `file-${i}.ts`), depth: 0 }];
    app.sidebarExpandedDirs.add("src");
    app.sidebarExpandedDirs.add("src:all");
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

  it("handles transcript and sidebar wheel behavior plus plan footer accent", () => {
    const app = new App() as any;
    app.messages = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `msg ${i}` }));
    app.scrollOffset = 6;
    app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 20, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.handleKey({ name: "scrolldown", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "scrollup", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "pageup", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "pagedown", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBe(6);

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

    app.mode = "plan";
    const footer = app.renderSidebarFooter();
    const footerText = footer.map((line: string) => stripAnsi(line)).join("\n");
    expect(footerText).toContain("plan");
  });
});

describe("wrapped input layout", () => {
  it("wraps long input lines and tracks cursor row/column", () => {
    const app = new App() as any;
    const layout = app.getInputCursorLayout("one two three four five", 23, 16);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.row).toBeGreaterThan(0);
  });

  it("renders the input without the old left gutter and expands for wrapped question input", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.input.paste("test");
    let rendered: string[] = [];
    app.screen = { height: 12, width: 40, hasSidebar: false, mainWidth: 40, sidebarWidth: 20, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const inputLine = rendered.find((line) => stripAnsi(line).trimEnd() === "test");
    expect(stripAnsi(inputLine!).trimEnd()).toBe("test");
    app.questionPrompt = { question: "Base URL", cursor: 0, textInput: "http://127.0.0.1:8080/v1/chat/completions/really/long/path", resolve: () => {} };
    expect(app.getBottomLineCount(20, 20)).toBeGreaterThan(6);
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
      expect(cursorRow).toBeGreaterThanOrEqual(rendered.length - 2);
    } finally {
      updateSetting("showTokens", original.showTokens);
      updateSetting("showCost", original.showCost);
      updateSetting("thinkingLevel", original.thinkingLevel);
      updateSetting("cavemanLevel", original.cavemanLevel ?? "off");
    }
  });
});
