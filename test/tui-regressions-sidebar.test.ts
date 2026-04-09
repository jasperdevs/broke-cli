import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import stripAnsi from "strip-ansi";

describe("command aliases", () => {
  it("suggests templates from the slash-command surface", () => {
    const app = new App() as any;
    app.input.paste("/tem");
    expect(app.getCommandMatches()[0].name).toBe("templates");
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
    expect(all).toContain("btw");
    expect(all).toContain("thinking");
  });

  it("keeps settings pinned first and shows hotkeys", () => {
    const app = new App() as any;
    app.input.paste("/");
    expect(app.getCommandMatches()[0].name).toBe("settings");
    const entries = app.getCommandSuggestionEntries().flatMap((entry: { lines: string[] }) => entry.lines.map((line) => stripAnsi(line)));
    expect(entries.some((entry: string) => entry.includes("settings"))).toBe(true);
    expect(entries.some((entry: string) => entry.includes("model"))).toBe(true);
    expect(entries.some((entry: string) => entry.includes("thinking"))).toBe(true);
  });
});

describe("sidebar scrolling", () => {
  it("keeps mouse tracking disabled for active chats so native terminal selection still works", () => {
    const originalHideSidebar = getSettings().hideSidebar;
    updateSetting("hideSidebar", false);
    try {
      const app = new App() as any;
      app.messages = [{ role: "user", content: "hello" }];
      app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
      expect(app.shouldEnableMenuMouse()).toBe(false);
    } finally {
      updateSetting("hideSidebar", originalHideSidebar);
    }
  });

  it("enables mouse capture only for genuinely interactive surfaces", () => {
    const app = new App() as any;
    expect(app.shouldEnableMenuMouse()).toBe(false);

    app.itemPicker = { title: "Projects", items: [], cursor: 0 };
    expect(app.shouldEnableMenuMouse()).toBe(true);

    app.itemPicker = null;
    app.questionView = { title: "Question" };
    expect(app.shouldEnableMenuMouse()).toBe(true);

    app.questionView = null;
    app.budgetView = { title: "Budget", reports: {}, scope: "all", section: "usage", scrollOffset: 0 };
    expect(app.shouldEnableMenuMouse()).toBe(true);
  });

  it("keeps long sidebar summaries scrollable", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hi" }];
    app.sidebarFocused = true;
    app.buildSidebarLines = () => [
      "Apr 7 #4821",
      "v0.0.1",
      "",
      "Chat provider/model",
      "Fast provider/model",
      "Review provider/model",
      "Planning provider/model",
      "Design/UI provider/model",
      "Architecture provider/model",
      "",
      "Directory",
      "  ~/repo",
      ...Array.from({ length: 12 }, (_, i) => `Connection ${i}`),
    ];
    const before = app.renderSidebar(12).map((line: string) => stripAnsi(line));
    app.scrollSidebar(4, 12);
    const after = app.renderSidebar(12).map((line: string) => stripAnsi(line));
    expect(before.join("\n")).toContain("Directory");
    expect(after[0]).toContain("^ more");
    expect(after.join("\n")).toContain("Connection");
  });

  it("keeps transcript scrolling on the keyboard path while still keeping sidebar menus interactive", () => {
    const originalShowTokens = getSettings().showTokens;
    updateSetting("showTokens", true);
    const app = new App() as any;
    app.messages = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `msg ${i}` }));
    app.scrollOffset = 8;
    app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 20, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.handleKey({ name: "pageup", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBeLessThan(8);

    const originalHideSidebar = getSettings().hideSidebar;
    updateSetting("hideSidebar", false);
    app.messages = [{ role: "user", content: "hello" }];
    app.sidebarFocused = true;
    app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.buildSidebarLines = () => Array.from({ length: 24 }, (_, i) => `sidebar ${i}`);
    try {
      app.openItemPicker("Projects", Array.from({ length: 12 }, (_, i) => ({ id: `project-${i}`, label: `Project ${i}`, detail: `detail line ${i}` })), () => {}, { kind: "projects" });
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
      expect(footerText).toContain("120k/128k");
      expect(footerText).not.toContain("plan");
    } finally {
      updateSetting("hideSidebar", originalHideSidebar);
    }
    updateSetting("showTokens", originalShowTokens);
  });

  it("keeps the slash menu and prompt cursor anchored when the sidebar footer is taller", () => {
    const app = new App() as any;
    const settings = getSettings();
    const original = {
      hideSidebar: settings.hideSidebar,
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
      updateSetting("hideSidebar", false);
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
      expect(output).toContain("build");
      expect(output).toContain("120k/128k");
      expect(output).toContain("621 out");
      expect(stripAnsi(rendered[cursorRow - 1] ?? "")).toContain("/");
    } finally {
      updateSetting("hideSidebar", original.hideSidebar);
      updateSetting("showTokens", original.showTokens);
      updateSetting("showCost", original.showCost);
      updateSetting("thinkingLevel", original.thinkingLevel);
      updateSetting("cavemanLevel", original.cavemanLevel ?? "off");
    }
  });

  it("keeps sidebar chat slash menus within a compact wrapped block", () => {
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
    const commandRows = output.filter((line) => line.includes("settings") || line.includes("configure options") || line.includes("model") || line.includes("switch model"));
    expect(commandRows.length).toBeLessThanOrEqual(8);
  });

  it("keeps the sidebar column visible while slash menus are open in active chats", () => {
    const originalHideSidebar = getSettings().hideSidebar;
    updateSetting("hideSidebar", false);
    try {
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
      expect(output).toContain("Current model");
      expect(output).not.toContain("Mode");
      expect(output).toContain("Role models");
      expect(output).not.toContain("same as chat");
      expect(output).not.toContain("Files");
    } finally {
      updateSetting("hideSidebar", originalHideSidebar);
    }
  });

  it("shows the same bottom info bar in sidebar chats without duplicating footer state", () => {
    const originalHideSidebar = getSettings().hideSidebar;
    updateSetting("hideSidebar", false);
    try {
      const app = new App() as any;
      let rendered: string[] = [];
      app.messages = [{ role: "user", content: "hello" }];
      app.setModel("OpenAI", "gpt-5.4-mini", { providerId: "openai", runtime: "sdk" });
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
      expect(output).toContain("build");
      expect(output).toContain("Role models");
      expect(output).toContain("Chat");
      const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
      expect(footer).toContain("0 total");
    } finally {
      updateSetting("hideSidebar", originalHideSidebar);
    }
  });

  it("scrolls transcript lines with keyboard paging in passive mode", () => {
    const app = new App() as any;
    app.messages = Array.from({ length: 40 }, (_, i) => ({ role: "assistant", content: `line ${i}` }));
    app.scrollOffset = 8;
    app.screen = { height: 16, width: 70, hasSidebar: false, mainWidth: 70, sidebarWidth: 20, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.handleKey({ name: "pageup", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBeLessThan(8);
  });

  it("keeps the sidebar footer visible while composing plain text and while streaming", () => {
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

      app.input.clear();
      app.setStreaming(true);
      const footerWhileStreaming = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
      expect(footerWhileStreaming).toContain("8.8k total");
      if (app.spinnerTimer) clearInterval(app.spinnerTimer);
    } finally {
      updateSetting("showTokens", originalShowTokens);
    }
  });

  it("keeps mode/thinking/caveman state off the sidebar footer", () => {
    const app = new App() as any;
    const original = {
      showTokens: getSettings().showTokens,
      showCost: getSettings().showCost,
      thinkingLevel: getSettings().thinkingLevel,
      cavemanLevel: getSettings().cavemanLevel,
    };
    try {
      updateSetting("showTokens", true);
      updateSetting("showCost", true);
      updateSetting("thinkingLevel", "low");
      updateSetting("cavemanLevel", "ultra");
      app.setContextUsage(120_000, 128_000);
      app.updateUsage(0.0021, 8_200, 621);
      const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
      expect(footer).toContain("8.8k total");
      expect(footer).not.toContain("build");
      expect(footer).not.toContain("plan");
      expect(footer).not.toContain("ultra");
      expect(footer).not.toContain("low");
    } finally {
      updateSetting("showTokens", original.showTokens);
      updateSetting("showCost", original.showCost);
      updateSetting("thinkingLevel", original.thinkingLevel);
      updateSetting("cavemanLevel", original.cavemanLevel ?? "off");
    }
  });

  it("uses a narrower sidebar width so chat keeps more space", () => {
    const app = new App() as any;
    app.screen = {
      height: 18,
      width: 100,
      hasSidebar: true,
      mainWidth: 79,
      sidebarWidth: 20,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    expect(app.screen.sidebarWidth).toBe(20);
    expect(app.screen.mainWidth).toBe(79);
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
