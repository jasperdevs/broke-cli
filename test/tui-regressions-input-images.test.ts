import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import { renderStaticMessages } from "../src/tui/render/messages.js";
import { wordWrap } from "../src/tui/render/formatting.js";

describe("cursor visibility", () => {
  it("keeps the input cursor active while streaming", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    let cursorRow = 0;
    let hidden = 0;
    app.messages = [{ role: "assistant", content: "working" }];
    app.isStreaming = true;
    app.input.setText("steer");
    app.screen = {
      height: 14,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: (row: number) => { cursorRow = row; },
      hideCursor: () => { hidden++; },
      forceRedraw: () => {},
    };
    app.drawImmediate();
    expect(hidden).toBe(0);
    expect(cursorRow).toBeGreaterThan(0);
    expect(stripAnsi(rendered[cursorRow - 1] ?? "")).toContain("steer");
  });

  it("keeps the cursor on the shared prompt row for tree filters", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    let cursorRow = 0;
    let hidden = 0;
    app.screen = {
      height: 14,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: (row: number) => { cursorRow = row; },
      hideCursor: () => { hidden++; },
      forceRedraw: () => {},
    };
    const session: any = {
      getLeafId: () => "a",
      getTreeItems: () => [{ id: "a", role: "user", content: "hello", depth: 0, hasChildren: false, active: true }],
    };
    app.openTreeView("Session Tree", session, () => {});
    app.drawImmediate();
    expect(hidden).toBe(0);
    expect(cursorRow).toBeGreaterThan(0);
    expect(stripAnsi(rendered[cursorRow - 1] ?? "")).toContain("/tree");
  });
});

describe("image attachments", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
  });

  it("attaches pasted image paths without writing the raw path into the input", () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const app = new App() as any;
    const dir = mkdtempSync(join(tmpdir(), "brokecli-image-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "shot.png");
    writeFileSync(imagePath, "fakepng", "utf-8");
    let rendered: string[] = [];
    app.screen = {
      height: 12,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.handlePaste(imagePath);
    app.input.setText("look at this");
    app.drawImmediate();

    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(app.pendingImages).toHaveLength(1);
    expect(app.input.getText()).toBe("look at this");
    expect(output).toContain("[Image #1]");
    expect(output).not.toContain(imagePath);
  });

  it("submits image-only prompts instead of dropping the attachment", () => {
    const app = new App() as any;
    let submitted: { text: string; images?: Array<{ mimeType: string; data: string }> } | null = null;
    app.onSubmit = (text: string, images?: Array<{ mimeType: string; data: string }>) => {
      submitted = { text, images };
    };
    app.pendingImages = [{ mimeType: "image/png", data: "abc" }];

    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });

    expect(submitted).toEqual({ text: "", images: [{ mimeType: "image/png", data: "abc" }] });
  });

  it("renders chat image tags with the same label format as prompt attachments", () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const lines = renderStaticMessages({
      messages: [{ role: "user", content: "look", images: [{ mimeType: "image/png", data: "abc" }] }],
      maxWidth: 48,
      toolOutputCollapsed: false,
      isToolOutput: () => false,
      wordWrap,
      colors: { imageTagBg: "", userBg: "", userText: "", userAccent: "", border: "", muted: "", text: "" },
      reset: "",
      bold: "",
    }).map((line) => stripAnsi(line)).join("\n");

    expect(lines).toContain("[Image #1]");
    expect(lines).not.toContain("[IMAGE 1]");
  });
});
