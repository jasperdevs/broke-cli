import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { getSettings, updateSetting } from "../src/core/config.js";
import { App } from "../src/tui/app.js";
import type { Keypress } from "../src/tui/keypress.js";

describe("thinking and input regressions", () => {
  it("deletes the previous word with Alt+Backspace", () => {
    const app = new App() as any;
    app.input.paste("hello brave world");
    const key: Keypress = { name: "backspace", char: "", ctrl: false, meta: true, shift: false };
    app.input.handleKey(key);
    expect(app.input.getText()).toBe("hello brave ");
  });

  it("shows the hidden thinking summary label instead of raw reasoning text", () => {
    const app = new App() as any;
    const original = getSettings().hideThinkingBlock;
    try {
      updateSetting("hideThinkingBlock", true);
      app.messages = [{ role: "assistant", content: "Reading files" }];
      app.isStreaming = true;
      app.setThinkingRequested(true);
      app.appendThinking("private chain of thought");
      const output = app.renderMessages(60).map((line: string) => stripAnsi(line)).join("\n");
      expect(output).toContain("Thinking...");
      expect(output).toContain("working through the request");
      expect(output).not.toContain("private chain of thought");
      expect(output).not.toContain("Reasoning");
    } finally {
      updateSetting("hideThinkingBlock", original);
    }
  });
});
