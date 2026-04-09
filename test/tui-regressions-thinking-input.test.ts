import { afterEach, describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { clearRuntimeSettings, getSettings, setRuntimeSettings, updateSetting } from "../src/core/config.js";
import { App } from "../src/tui/app.js";
import type { Keypress } from "../src/tui/keypress.js";

const tempRoots: string[] = [];

async function addTempSkill(name: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "brokecli-tui-skill-"));
  tempRoots.push(root);
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n\nUse ${name}.\n`, "utf8");
  setRuntimeSettings({ skills: [root], discoverSkills: false });
}

afterEach(async () => {
  clearRuntimeSettings();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("thinking and input regressions", () => {
  it("deletes the previous word with Alt+Backspace", () => {
    const app = new App() as any;
    app.input.paste("hello brave world");
    const key: Keypress = { name: "backspace", char: "", ctrl: false, meta: true, shift: false };
    app.input.handleKey(key);
    expect(app.input.getText()).toBe("hello brave ");
  });

  it("hides reasoning entirely when the hidden-thinking setting is on", () => {
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
      expect(output).not.toContain("private chain of thought");
      expect(output).not.toContain("Reasoning");
    } finally {
      updateSetting("hideThinkingBlock", original);
    }
  });

  it("hides already-rendered reasoning after the hidden-thinking setting is toggled", () => {
    const app = new App() as any;
    const original = getSettings().hideThinkingBlock;
    try {
      updateSetting("hideThinkingBlock", false);
      app.appendThinking("persisted thought");
      expect(app.renderStaticMessages(80).map((line: string) => stripAnsi(line)).join("\n")).toContain("persisted thought");
      updateSetting("hideThinkingBlock", true);
      expect(app.renderStaticMessages(80).map((line: string) => stripAnsi(line)).join("\n")).not.toContain("persisted thought");
    } finally {
      updateSetting("hideThinkingBlock", original);
    }
  });

  it("scrolls the transcript with plain arrows when the composer is empty", () => {
    const app = new App() as any;
    for (let i = 0; i < 40; i++) app.messages.push({ role: "assistant", content: `line ${i}` });
    app.scrollToBottom();
    const bottomOffset = app.scrollOffset;
    app.handleKey({ name: "up", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBeLessThan(bottomOffset);
    app.handleKey({ name: "down", char: "", ctrl: false, meta: false, shift: false });
    expect(app.scrollOffset).toBeGreaterThanOrEqual(bottomOffset - 1);
  });

  it("opens an inline $skill picker and inserts the selected skill as an atomic token", async () => {
    await addTempSkill("writer");
    const app = new App() as any;
    app.handlePaste("use ");
    app.handleKey({ name: "", char: "$", ctrl: false, meta: false, shift: false });
    expect(app.itemPicker?.title).toBe("Skills");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("use $writer");
    expect(app.input.getElements().some((element: any) => element.kind === "skill" && element.label === "$writer")).toBe(true);
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("use");
  });

  it("does not show a synthetic streaming activity summary", () => {
    const app = new App() as any;
    app.messages = [{ role: "assistant", content: "working" }];
    app.setStreamingActivitySummary("planning changes to index.html");
    app.setStreaming(true);
    const output = app.renderMessages(60).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("Working");
    expect(output).not.toContain("planning changes to index.html");
    expect(output).not.toContain("Working:");
    app.setStreaming(false);
    expect(app.currentActivityStep).toBeNull();
  });
});
