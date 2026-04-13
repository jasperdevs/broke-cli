import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";

describe("model picker auto routing", () => {
  it("shows auto first with plain-language picker copy", () => {
    const app = new App() as any;
    app.openModelPicker(
      [
        { providerId: "__auto__", providerName: "Automatic routing", modelId: "__auto__", displayName: "Auto", active: false, badges: ["auto"], tone: "auto" },
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
    expect(pickerText).toContain("Auto");
    expect(pickerText).toContain("enter choose use");
    expect(pickerText).toContain("space favorite");
    expect(pickerText).toContain("OpenAI");
    expect(pickerText).not.toContain("a assign lane");
    expect(pickerText).not.toContain("Scope:");
  });

  it("shows the active filter in picker headers", () => {
    const app = new App() as any;
    app.openModelPicker(
      [
        { providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", displayName: "GPT-5.4 mini", active: true },
        { providerId: "openai", providerName: "OpenAI", modelId: "gpt-4o", displayName: "GPT-4o", active: false },
      ],
      () => {},
      () => {},
    );
    app.input.setText("/model gpt-4");
    let rendered: string[] = [];
    app.screen = { height: 16, width: 72, hasSidebar: false, mainWidth: 72, sidebarWidth: 20, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const pickerText = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(pickerText).toContain("filter gpt-4");
    expect(pickerText).toContain("GPT-4o");
  });
});
