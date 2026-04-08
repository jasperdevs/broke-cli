import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
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

  it("keeps the cursor directly after the image chip instead of counting ANSI bytes", () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const app = new App() as any;
    const dir = mkdtempSync(join(tmpdir(), "brokecli-image-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "cursor.png");
    writeFileSync(imagePath, "fakepng", "utf-8");
    let cursorRow = 0;
    let cursorCol = 0;
    app.screen = {
      height: 12,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 0,
      render: () => {},
      setCursor: (row: number, col: number) => { cursorRow = row; cursorCol = col; },
      hideCursor: () => {},
      forceRedraw: () => {},
    };

    app.handlePaste(imagePath);
    app.drawImmediate();

    expect(app.pendingImages).toHaveLength(1);
    expect(cursorRow).toBeGreaterThan(0);
    expect(cursorCol).toBeLessThan(20);
  });

  it("clears a raw pasted image path from the draft when the attachment loads", () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const app = new App() as any;
    const dir = mkdtempSync(join(tmpdir(), "brokecli-image-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "stuck.png");
    writeFileSync(imagePath, "fakepng", "utf-8");

    app.input.setText(imagePath);
    app.handlePaste(imagePath);

    expect(app.pendingImages).toHaveLength(1);
    expect(app.input.getText()).toBe("");
    expect(app.statusMessage).toBeUndefined();
  });

  it("clears a mirrored image path that arrives one tick after attachment", async () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const app = new App() as any;
    const dir = mkdtempSync(join(tmpdir(), "brokecli-image-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "delayed.png");
    writeFileSync(imagePath, "fakepng", "utf-8");

    app.handlePaste(imagePath);
    app.input.setText(imagePath);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.pendingImages).toHaveLength(1);
    expect(app.input.getText()).toBe("");
  });

  it("auto-attaches an image path typed into an empty draft", () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const app = new App() as any;
    const dir = mkdtempSync(join(tmpdir(), "brokecli-image-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "drop.png");
    writeFileSync(imagePath, "fakepng", "utf-8");

    app.input.setText(imagePath);
    app.handleKey({ name: "x", char: "", ctrl: false, meta: false, shift: false });

    expect(app.pendingImages).toHaveLength(1);
    expect(app.input.getText()).toBe("");
  });

  it("auto-attaches an image path when it arrives through the generic text paste path", () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const app = new App() as any;
    const dir = mkdtempSync(join(tmpdir(), "brokecli-image-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "generic.png");
    writeFileSync(imagePath, "fakepng", "utf-8");

    app.handlePaste(` ${imagePath} `);

    expect(app.pendingImages).toHaveLength(1);
    expect(app.input.getText()).toBe("");
  });

  it("resolves transient Yoink image paths to the newest saved image", () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const app = new App() as any;
    const dir = mkdtempSync(join(tmpdir(), "brokecli-image-"));
    tempDirs.push(dir);
    const yoinkDir = join(dir, "Yoink");
    mkdirSync(yoinkDir);
    const actualImagePath = join(yoinkDir, "yoink_2026-04-08_16-58-56_950c.png");
    writeFileSync(actualImagePath, "fakepng", "utf-8");

    app.handlePaste(join(yoinkDir, "yoink_--_--_b.png"));

    expect(app.pendingImages).toHaveLength(1);
    expect(app.input.getText()).toBe("");
  });

  it("resolves a transient Yoink image path even when pasted after other draft text", async () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const app = new App() as any;
    const dir = mkdtempSync(join(tmpdir(), "brokecli-image-"));
    tempDirs.push(dir);
    const yoinkDir = join(dir, "Yoink");
    mkdirSync(yoinkDir);
    const transientPath = join(yoinkDir, "yoink_--_--_b.png");
    const actualImagePath = join(yoinkDir, "yoink_2026-04-08_16-58-56_950c.png");
    writeFileSync(actualImagePath, "fakepng", "utf-8");

    app.input.setText("hey ");
    app.handlePaste(transientPath);
    await new Promise((resolve) => setTimeout(resolve, 160));

    expect(app.pendingImages).toHaveLength(1);
    expect(app.input.getText()).toBe("hey ");
  });

  it("removes the last attachment chip with backspace when the draft is empty", () => {
    const app = new App() as any;
    app.pendingImages = [{ mimeType: "image/png", data: "abc" }];
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.pendingImages).toHaveLength(0);
  });

  it("inserts selected @ files inline instead of pinning them to the prompt prefix", () => {
    const app = new App() as any;
    app.filePicker = { files: ["AGENTS.md"], filtered: ["AGENTS.md"], query: "AG", cursor: 0 };
    app.input.setText("check @AG");

    app.selectFileEntry(0);

    expect(app.input.getText()).toBe("check [AGENTS.md] ");
    expect(app.fileContexts.has("AGENTS.md")).toBe(true);
  });

  it("strips inline @ chip labels before submit while keeping file context", () => {
    const app = new App() as any;
    let submitted = "";
    app.onSubmit = (text: string) => { submitted = text; };
    app.fileContexts.set("AGENTS.md", "# Project Instructions");
    app.input.setText("check [AGENTS.md] now");

    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });

    expect(submitted).toBe("check now");
  });

  it("keeps pasted image paths out of the middle of an inline file chip", () => {
    updateSetting("terminal", { ...getSettings().terminal, showImages: true });
    const app = new App() as any;
    const dir = mkdtempSync(join(tmpdir(), "brokecli-image-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "inside-chip.png");
    writeFileSync(imagePath, "fakepng", "utf-8");

    app.fileContexts.set("exports.ts", "export {}");
    app.input.setText("[exports.ts] ");
    app.input.setCursor(4);

    app.handlePaste(imagePath);

    expect(app.pendingImages).toHaveLength(1);
    expect(app.input.getText()).toBe("[exports.ts] ");
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
