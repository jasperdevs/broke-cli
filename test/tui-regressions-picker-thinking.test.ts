import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";
import { currentTheme, listThemes } from "../src/core/themes.js";
import { getConfiguredModelPreference, getSettings, updateModelPreference, updateSetting } from "../src/core/config.js";
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

  it("ignores mouse wheel input in long file menus", () => {
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
    expect(app.filePicker.cursor).toBe(0);
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).toContain("src/file-0.ts");
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

  it("uses plain-language model picker copy", () => {
    const app = new App() as any;
    app.openModelPicker(
      [
        { providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", displayName: "GPT-5.4 mini", active: true },
        { providerId: "openai", providerName: "OpenAI", modelId: "gpt-4o", displayName: "GPT-4o", active: false },
      ],
      () => {},
      () => {},
    );
    let rendered: string[] = [];
    app.screen = { height: 16, width: 60, hasSidebar: false, mainWidth: 60, sidebarWidth: 20, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const pickerText = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(pickerText).toContain("enter choose use");
    expect(pickerText).toContain("space favorite");
    expect(pickerText).toContain("OpenAI");
    expect(pickerText).not.toContain("a assign lane");
    expect(pickerText).not.toContain("Scope:");
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
      displayName: `Model ${i}`,
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
    const visibleModels = output.filter((line) => /Model \d+/.test(line));
    expect(visibleModels.length).toBeLessThanOrEqual(5);
    expect(output.join("\n")).not.toContain("Model 5");
  });

  it("opens the usage picker when you press enter on a model", () => {
    const app = new App() as any;
    app.openModelPicker(
      [{ providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", displayName: "GPT-5.4 mini", active: false }],
      () => {},
      () => {},
      () => {},
    );
    app.handleKey({ name: "enter", char: "", ctrl: false, meta: false, shift: false });
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
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Assign selected model");
    expect(output).toContain("Use everywhere");
    app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
    app.drawImmediate();
    const scrolledOutput = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(scrolledOutput).toContain("Use for fast");
    expect(scrolledOutput).toContain("chat naming");
  });

  it("shows current lane ownership and lets one action assign every lane", () => {
    const app = new App() as any;
    const selectedCalls: Array<[string, string]> = [];
    const assignedCalls: Array<[string, string, string]> = [];
    const originalPrefs = {
      default: getConfiguredModelPreference("default") ?? null,
      small: getConfiguredModelPreference("small") ?? null,
      btw: getConfiguredModelPreference("btw") ?? null,
      review: getConfiguredModelPreference("review") ?? null,
      planning: getConfiguredModelPreference("planning") ?? null,
      ui: getConfiguredModelPreference("ui") ?? null,
      architecture: getConfiguredModelPreference("architecture") ?? null,
    };
    app.modelProviderId = "openai";
    try {
      updateModelPreference("default", "openai/gpt-5.4-mini");
      updateModelPreference("small", "openai/gpt-4o-mini");
      updateModelPreference("btw", "openai/gpt-4.1-mini");
      updateModelPreference("review", "openai/gpt-4.1");
      updateModelPreference("planning", "openai/o3");
      updateModelPreference("ui", "openai/gpt-5.4-mini");
      updateModelPreference("architecture", "openai/o4-mini");
      app.openModelPicker(
        [{ providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", displayName: "GPT-5.4 mini", active: false }],
        (providerId: string, modelId: string) => selectedCalls.push([providerId, modelId]),
        () => {},
        (providerId: string, modelId: string, slot: string) => assignedCalls.push([providerId, modelId, slot]),
        () => {},
      );
      app.handleKey({ name: "enter", char: "", ctrl: false, meta: false, shift: false });
      let rendered: string[] = [];
      app.screen = {
        height: 24,
        width: 100,
        hasSidebar: false,
        mainWidth: 100,
        sidebarWidth: 20,
        render: (lines: string[]) => { rendered = lines; },
        setCursor: () => {},
        hideCursor: () => {},
        forceRedraw: () => {},
      };
      app.drawImmediate();
      const output = rendered.map((line) => stripAnsi(line)).join("\n");
      expect(output).toContain("Use everywhere");
      expect(output).toContain("Use for chat (already selected)");
      app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
      app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
      app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
      app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
      app.drawImmediate();
      const scrolledOutput = rendered.map((line) => stripAnsi(line)).join("\n");
      expect(scrolledOutput).toContain("Use for /btw");
      app.selectModelLaneEntry(0);
      expect(selectedCalls).toEqual([["openai", "gpt-5.4-mini"]]);
      expect(assignedCalls).toEqual([
        ["openai", "gpt-5.4-mini", "default"],
        ["openai", "gpt-5.4-mini", "small"],
        ["openai", "gpt-5.4-mini", "btw"],
        ["openai", "gpt-5.4-mini", "review"],
        ["openai", "gpt-5.4-mini", "planning"],
        ["openai", "gpt-5.4-mini", "ui"],
        ["openai", "gpt-5.4-mini", "architecture"],
      ]);
    } finally {
      updateModelPreference("default", originalPrefs.default);
      updateModelPreference("small", originalPrefs.small);
      updateModelPreference("btw", originalPrefs.btw);
      updateModelPreference("review", originalPrefs.review);
      updateModelPreference("planning", originalPrefs.planning);
      updateModelPreference("ui", originalPrefs.ui);
      updateModelPreference("architecture", originalPrefs.architecture);
    }
  });
});

describe("thinking preview", () => {
  it("shows thinking immediately when requested even before reasoning text arrives", () => {
    const app = new App() as any;
    app.setStreaming(true);
    app.setThinkingRequested(true);
    app.setStreamingActivitySummary("planning changes to README.md");
    const output = app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("Thinking...");
    expect(output).not.toContain("planning changes to README.md");
    expect(output).not.toContain("Reasoning");
    app.setStreaming(false);
  });

  it("does not add a synthetic waiting line during long silent thinking", () => {
    const app = new App() as any;
    app.setStreaming(true);
    app.setThinkingRequested(true);
    app.streamStartTime = Date.now() - 9000;
    const output = app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).not.toContain("waiting for first visible event");
    app.setStreaming(false);
  });

  it("persists streamed thinking in the transcript after the answer and next user turn", () => {
    const app = new App() as any;
    app.setStreaming(true);
    app.appendThinking("first pass");
    app.appendToLastMessage("final answer");
    app.setStreaming(false);
    let output = app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("Thinking");
    expect(output).toContain("first pass");
    expect(output.indexOf("first pass")).toBeLessThan(output.indexOf("final answer"));
    app.addMessage("user", "next");
    output = app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("first pass");
    expect(output).toContain("next");
  });

  it("renders all streamed thinking instead of truncating to a tail preview", () => {
    const app = new App() as any;
    app.setStreaming(true);
    app.appendThinking(Array.from({ length: 12 }, (_, index) => `thought ${index + 1}`).join("\n"));
    const output = app.renderMessages(120).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("thought 1");
    expect(output).toContain("thought 12");
  });

  it("does not append churn notes into the transcript when a stream ends", () => {
    const app = new App() as any;
    app.setStreaming(true);
    app.setStreamTokens(11);
    app.appendToLastMessage("done");
    app.setStreaming(false);
    const transcript = app.messages.map((msg: any) => stripAnsi(msg.content)).join("\n");
    expect(transcript).toContain("done");
    expect(transcript).not.toContain("Churned for");
  });

  it("rolls back the newest assistant draft even if a system note was appended after it", () => {
    const app = new App() as any;
    app.addMessage("user", "make file");
    app.addMessage("assistant", "draft reply");
    app.addMessage("system", "note");
    app.rollbackLastAssistantMessage();
    expect(app.messages.map((msg: any) => `${msg.role}:${stripAnsi(msg.content)}`)).toEqual([
      "user:make file",
      "system:note",
    ]);
  });
});

describe("tool-call visibility", () => {
  it("shows live status for running tools before results arrive", () => {
    const app = new App() as any;
    app.screen = {
      height: 16,
      width: 80,
      hasSidebar: false,
      mainWidth: 80,
      sidebarWidth: 0,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.addToolCall("readFile", "...");
    const output = app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("starting");
    expect(output).toContain("waiting for tool details");
  });

  it("shows completion timing once a tool finishes", () => {
    const app = new App() as any;
    app.screen = {
      height: 16,
      width: 80,
      hasSidebar: false,
      mainWidth: 80,
      sidebarWidth: 0,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.addToolCall("readFile", "README.md");
    app.toolExecutions[0].startedAt = Date.now() - 2100;
    app.addToolResult("readFile", "ok", false, "42 lines");
    const output = app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("done");
    expect(output).toContain("2s");
    expect(output).toContain("42 lines");
  });

  it("keeps repeated tool names separate when execution ids differ", () => {
    const app = new App() as any;
    app.screen = {
      height: 16,
      width: 80,
      hasSidebar: false,
      mainWidth: 80,
      sidebarWidth: 0,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.addToolCall("readFile", "...", undefined, "call_a");
    app.addToolCall("readFile", "...", undefined, "call_b");
    app.updateToolCallArgs("readFile", "README.md", { path: "README.md" }, "call_a");
    app.updateToolCallArgs("readFile", "package.json", { path: "package.json" }, "call_b");
    app.addToolResult("readFile", "ok", false, "42 lines", "call_a");
    const output = app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("1.");
    expect(output).toContain("2.");
    expect(output).toContain("read README.md");
    expect(output).toContain("read package.json");
    expect(output).toContain("42 lines");
    expect(app.toolExecutions[1].status).toBe("running");
  });
});

describe("theme catalog", () => {
  it("exposes the built-in theme catalog", () => {
    const themes = listThemes();
    expect(themes.length).toBeGreaterThan(5);
    expect(themes.some((theme) => theme.key === "brokecli")).toBe(true);
    expect(themes.some((theme) => theme.key === "github-dark")).toBe(true);
  });

  it("tints the built-in palette when plan mode is active", () => {
    const previousMode = getSettings().mode;
    const previousTheme = getSettings().theme;
    try {
      updateSetting("theme", "brokecli");
      updateSetting("mode", "build");
      const buildTheme = currentTheme();
      updateSetting("mode", "plan");
      const planTheme = currentTheme();
      expect(planTheme.primary).not.toBe(buildTheme.primary);
      expect(planTheme.background).not.toBe(buildTheme.background);
      expect(planTheme.sidebarBackground).not.toBe(buildTheme.sidebarBackground);
    } finally {
      updateSetting("mode", previousMode);
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
