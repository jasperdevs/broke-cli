import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";
import { currentTheme, listThemes, setPreviewTheme } from "../src/core/themes.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import stripAnsi from "strip-ansi";

describe("picker menus", () => {
  it("pushes chat upward when a menu opens instead of overlaying the last messages", () => {
    const app = new App() as any;
    app.messages = Array.from({ length: 18 }, (_, i) => ({ role: "assistant", content: `line ${i}` }));
    let rendered: string[] = [];
    app.screen = { height: 16, width: 60, hasSidebar: false, mainWidth: 60, sidebarWidth: 20, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.scrollToBottom();
    app.drawImmediate();
    const before = rendered.map((line) => stripAnsi(line));
    expect(before.join("\n")).toContain("line 17");

    app.openItemPicker("Pick one", [{ id: "one", label: "First" }, { id: "two", label: "Second" }, { id: "three", label: "Third" }], () => {});
    app.drawImmediate();
    const after = rendered.map((line) => stripAnsi(line));
    const menuStart = after.findIndex((line) => line.includes("Pick one"));
    expect(menuStart).toBeGreaterThan(0);
    expect(after.slice(0, menuStart).join("\n")).toContain("line 17");
  });

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
    app.screen = { height: 16, width: 60, hasSidebar: false, mainWidth: 60, sidebarWidth: 20, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    for (let i = 0; i < 8; i++) app.handleKey({ name: "scrolldown", char: "", ctrl: false, meta: false, shift: false });
    app.drawImmediate();
    expect(app.filePicker.cursor).toBe(8);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("src/file-8.ts");
  });

  it("lets visible picker rows be selected with a click", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    const selected: string[] = [];
    app.openItemPicker("Pick one", [{ id: "one", label: "First" }, { id: "two", label: "Second" }, { id: "three", label: "Third" }], (id: string) => selected.push(id));
    let rendered: string[] = [];
    app.screen = { height: 16, width: 60, hasSidebar: false, mainWidth: 60, sidebarWidth: 20, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const row = rendered.findIndex((line) => stripAnsi(line).includes("Second"));
    app.handleKey({ name: "click", char: `5,${row + 1}`, ctrl: false, meta: false, shift: false });
    expect(selected).toEqual(["two"]);
    expect(app.itemPicker).toBeNull();
  });

  it("uses plain-language model picker copy and restores theme preview on escape", () => {
    const app = new App() as any;
    app.openModelPicker(
      [
        { providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", active: true },
        { providerId: "openai", providerName: "OpenAI", modelId: "gpt-4o", active: false },
      ],
      () => {},
      () => {},
    );
    let rendered: string[] = [];
    app.screen = { height: 16, width: 60, hasSidebar: false, mainWidth: 60, sidebarWidth: 20, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const pickerText = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(pickerText).toContain("enter switch");
    expect(pickerText).toContain("space favorite");
    expect(pickerText).toContain("set selected as: 1 chat");
    expect(pickerText).not.toContain("Scope:");

    const originalTheme = getSettings().theme;
    const themes = listThemes().slice(0, 4);
    try {
      updateSetting("theme", themes[0].key);
      app.openItemPicker("Theme", themes.map((theme) => ({ id: theme.key, label: theme.label })), () => {}, {
        initialCursor: 0,
        onPreview: (themeId: string) => setPreviewTheme(themeId),
        onCancel: () => setPreviewTheme(null),
      });
      app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
      expect(currentTheme().key).toBe(themes[1].key);
      app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
      expect(currentTheme().key).toBe(themes[0].key);
    } finally {
      setPreviewTheme(null);
      updateSetting("theme", originalTheme);
    }
  });

  it("keeps pickers usable at the bottom of the list instead of dropping the cursor out of range", () => {
    const app = new App() as any;
    app.openItemPicker("Pick one", [{ id: "one", label: "First" }], () => {});
    app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
    expect(app.itemPicker.cursor).toBe(0);

    app.openModelPicker(
      [{ providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", active: false }],
      () => {},
    );
    app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
    expect(app.modelPicker.cursor).toBe(0);
  });

  it("renders long model lists inline and keeps the last item reachable", () => {
    const app = new App() as any;
    const models = Array.from({ length: 18 }, (_, i) => ({
      providerId: i < 9 ? "openai" : "anthropic",
      providerName: i < 9 ? "OpenAI" : "Anthropic",
      modelId: `model-${i}`,
      active: false,
    }));
    app.openModelPicker(models, () => {});
    let rendered: string[] = [];
    app.screen = {
      height: 14,
      width: 72,
      hasSidebar: false,
      mainWidth: 72,
      sidebarWidth: 20,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.handleKey({ name: "end", char: "", ctrl: false, meta: false, shift: false });
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Select model");
    expect(output).toContain("/model");
    expect(output).toContain("model-17");
    expect(output).not.toContain("no matches");
    expect(output).toContain("space favorite");
  });

  it("caps item pickers to five visible rows even in tall panes", () => {
    const app = new App() as any;
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `id-${i}`, label: `Item ${i}` }));
    app.openItemPicker("Pick one", items, () => {});
    let rendered: string[] = [];
    app.screen = {
      height: 24,
      width: 72,
      hasSidebar: false,
      mainWidth: 72,
      sidebarWidth: 20,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line));
    const visibleItems = output.filter((line) => /Item \d+/.test(line));
    expect(visibleItems).toHaveLength(5);
    expect(output.join("\n")).not.toContain("Item 5");
  });

  it("caps model pickers to five visible rows even in tall panes", () => {
    const app = new App() as any;
    const models = Array.from({ length: 12 }, (_, i) => ({
      providerId: "openai",
      providerName: "OpenAI",
      modelId: `model-${i}`,
      active: false,
    }));
    app.openModelPicker(models, () => {});
    let rendered: string[] = [];
    app.screen = {
      height: 24,
      width: 72,
      hasSidebar: false,
      mainWidth: 72,
      sidebarWidth: 20,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line));
    const visibleModels = output.filter((line) => /model-\d+/.test(line));
    expect(visibleModels.length).toBeLessThanOrEqual(5);
    expect(output.join("\n")).not.toContain("model-5");
  });
});

describe("thinking preview", () => {
  it("shows thinking immediately when requested even before reasoning text arrives", () => {
    const app = new App() as any;
    app.setStreaming(true);
    app.setThinkingRequested(true);
    const output = app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("Thinking...");
    expect(output).not.toContain("waiting for model reasoning");
    expect(output).not.toContain("Reasoning");
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

  it("applies the active theme background across rendered rows and keeps dark background empty", () => {
    const app = new App() as any;
    const previousTheme = getSettings().theme;
    let rendered: string[] = [];
    try {
      updateSetting("theme", "brokecli-light");
      app.messages = [{ role: "user", content: "hello" }];
      app.input.paste("test");
      app.screen = { height: 12, width: 40, hasSidebar: false, mainWidth: 40, sidebarWidth: 20, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
      app.drawImmediate();
      expect(rendered[0]).toContain(currentTheme().background);
      updateSetting("theme", "brokecli-dark");
      setPreviewTheme(null);
      expect(currentTheme().background).toBe("");
    } finally {
      updateSetting("theme", previousTheme);
    }
  });
});

describe("interrupt prompts", () => {
  it("primes escape before aborting a stream and keeps ctrl+c inline", () => {
    const app = new App() as any;
    let aborted = 0;
    app.setStreaming(true);
    app.onAbort = () => { aborted++; };
    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
    expect(app.escPrimed).toBe(true);
    app.handleKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
    expect(aborted).toBe(1);
    app.handleKey({ name: "c", char: "\u0003", ctrl: true, meta: false, shift: false });
    expect(app.ctrlCCount).toBe(1);
    expect(app.statusMessage).toBeUndefined();
  });
});
