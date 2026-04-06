import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";

function key(name: string, char = "", extra: Partial<{ ctrl: boolean; meta: boolean; shift: boolean }> = {}) {
  return {
    name,
    char,
    ctrl: false,
    meta: false,
    shift: false,
    ...extra,
  };
}

describe("question UI", () => {
  it("renders questions fullscreen and cancels cleanly", async () => {
    const app = new App() as any;
    app.messages = [{ role: "assistant", content: "hello" }];
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

    const pending = app.showQuestion("Base URL");
    app.drawImmediate();
    const text = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(text).toContain("Question");
    expect(text).toContain("Base URL");
    expect(text).toContain("esc cancel");

    app.handleKey(key("escape"));
    await expect(pending).resolves.toBe("[user skipped]");
    expect(app.questionView).toBeNull();
  });

  it("supports multi-step forms with single choice, multi choice, and text answers", async () => {
    const app = new App() as any;
    app.screen = {
      height: 20,
      width: 72,
      hasSidebar: false,
      mainWidth: 72,
      sidebarWidth: 20,
      render: () => {},
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    const pending = app.showQuestionnaire({
      title: "Setup",
      submitLabel: "Submit",
      questions: [
        {
          id: "scope",
          label: "Scope",
          prompt: "Pick a scope",
          kind: "single",
          required: true,
          options: [
            { value: "small", label: "Small" },
            { value: "large", label: "Large" },
          ],
        },
        {
          id: "targets",
          label: "Targets",
          prompt: "Pick targets",
          kind: "multi",
          required: true,
          maxSelections: 3,
          options: [
            { value: "ui", label: "UI" },
            { value: "cli", label: "CLI" },
            { value: "tests", label: "Tests" },
          ],
        },
        {
          id: "notes",
          label: "Notes",
          prompt: "Add notes",
          kind: "text",
          required: true,
          options: [],
          placeholder: "type notes",
        },
      ],
    });

    app.handleKey(key("down"));
    app.handleKey(key("return"));
    app.handleKey(key("space", " "));
    app.handleKey(key("down"));
    app.handleKey(key("space", " "));
    app.handleKey(key("return"));
    app.handleKey(key("n", "n"));
    app.handleKey(key("o", "o"));
    app.handleKey(key("t", "t"));
    app.handleKey(key("e", "e"));
    app.handleKey(key("s", "s"));
    app.handleKey(key("return"));
    app.handleKey(key("return"));

    await expect(pending).resolves.toEqual({
      cancelled: false,
      answers: [
        { id: "scope", kind: "single", value: "large", label: "Large" },
        { id: "targets", kind: "multi", value: ["ui", "cli"], label: ["UI", "CLI"] },
        { id: "notes", kind: "text", value: "notes", label: "notes", custom: true },
      ],
    });
  });
});
