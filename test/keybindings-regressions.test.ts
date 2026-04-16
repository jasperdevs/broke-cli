import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { App } from "../src/tui/app.js";
import { applyKeybindingDefaults, reloadKeybindings } from "../src/core/keybindings.js";
import { buildLegacyFooterLines } from "../src/tui/bottom-ui.js";
import { updateSetting } from "../src/core/config.js";

describe("keybinding regressions", () => {
  it("ignores legacy tree hotkeys even if a saved keybindings file still has alt+a", () => {
    const keybindingsPath = join(homedir(), ".brokecli", "keybindings.json");
    const previous = existsSync(keybindingsPath) ? readFileSync(keybindingsPath, "utf-8") : null;
    try {
      mkdirSync(join(homedir(), ".brokecli"), { recursive: true });
      writeFileSync(keybindingsPath, JSON.stringify({ treeView: "alt+a" }), "utf-8");
      reloadKeybindings();

      const app = new App() as any;
      let submitted = "";
      app.onSubmit = (text: string) => { submitted = text; };
      app.handleKey({ name: "a", char: "", ctrl: false, meta: true, shift: false });
      expect(submitted).toBe("");
    } finally {
      if (previous == null) rmSync(keybindingsPath, { force: true });
      else writeFileSync(keybindingsPath, previous, "utf-8");
      reloadKeybindings();
    }
  });

  it("keeps shift-enter as the default newline binding on Windows too", () => {
    const bindings = applyKeybindingDefaults(
      { newline: "shift+return" },
      { TERM: "xterm-256color", TERM_PROGRAM: "" } as NodeJS.ProcessEnv,
      "win32",
    );
    expect(bindings.newline).toBe("shift+return");
  });

  it("migrates stale newline and submit bindings that break the composer contract", () => {
    const bindings = applyKeybindingDefaults(
      { newline: "ctrl+j", submit: "down", toggleMode: "tab" },
      { TERM: "xterm-256color", TERM_PROGRAM: "" } as NodeJS.ProcessEnv,
      "win32",
    );
    expect(bindings.newline).toBe("shift+return");
    expect(bindings.submit).toBe("return");
    expect(bindings.toggleMode).toBe("shift+tab");
  });

  it("renders the active newline binding in the legacy footer helper", () => {
    const keybindingsPath = join(homedir(), ".brokecli", "keybindings.json");
    const previous = existsSync(keybindingsPath) ? readFileSync(keybindingsPath, "utf-8") : null;
    try {
      mkdirSync(join(homedir(), ".brokecli"), { recursive: true });
      writeFileSync(keybindingsPath, JSON.stringify({ newline: "shift+return" }), "utf-8");
      reloadKeybindings();

      const app = new App() as any;
      const footer = buildLegacyFooterLines(app, false, 80).join("\n");
      expect(footer).toContain("shift + enter");
      expect(footer).toContain("for newline");
    } finally {
      if (previous == null) rmSync(keybindingsPath, { force: true });
      else writeFileSync(keybindingsPath, previous, "utf-8");
      reloadKeybindings();
    }
  });

  it("honors the configured newline binding in the live composer path", () => {
    const keybindingsPath = join(homedir(), ".brokecli", "keybindings.json");
    const previous = existsSync(keybindingsPath) ? readFileSync(keybindingsPath, "utf-8") : null;
    try {
      mkdirSync(join(homedir(), ".brokecli"), { recursive: true });
      writeFileSync(keybindingsPath, JSON.stringify({ newline: "shift+return" }), "utf-8");
      reloadKeybindings();

      const app = new App() as any;
      app.handlePaste("hello");
      app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: true });
      expect(app.input.getText()).toBe("hello\n");
    } finally {
      if (previous == null) rmSync(keybindingsPath, { force: true });
      else writeFileSync(keybindingsPath, previous, "utf-8");
      reloadKeybindings();
    }
  });

  it("honors the configured queue-message binding in the live composer path", () => {
    const keybindingsPath = join(homedir(), ".brokecli", "keybindings.json");
    const previous = existsSync(keybindingsPath) ? readFileSync(keybindingsPath, "utf-8") : null;
    try {
      mkdirSync(join(homedir(), ".brokecli"), { recursive: true });
      writeFileSync(keybindingsPath, JSON.stringify({ queueMessage: "ctrl+q" }), "utf-8");
      reloadKeybindings();
      const app = new App() as any;
      app.isStreaming = true; app.onSubmit = () => {};
      app.input.paste("queued");
      app.handleKey({ name: "q", char: "", ctrl: true, meta: false, shift: false });
      expect(app.pendingMessages).toEqual([{ text: "queued", images: [], delivery: "followup" }]);
    } finally {
      if (previous == null) rmSync(keybindingsPath, { force: true });
      else writeFileSync(keybindingsPath, previous, "utf-8");
      reloadKeybindings();
    }
  });

  it("treats raw linefeed as newline in the live composer path even before submit routing", () => {
    const app = new App() as any;
    app.handlePaste("hello");
    app.handleKey({ name: "linefeed", char: "\n", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("hello\n");
  });

  it("supports common macOS and Linux terminal editing chords", () => {
    const app = new App() as any;
    app.handlePaste("hello brave new world");
    app.input.setCursor(app.input.getText().length);
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: true, shift: false });
    expect(app.input.getText()).toBe("hello brave new ");
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false, super: true });
    expect(app.input.getText()).toBe("");

    app.handlePaste("alpha beta gamma");
    app.input.setCursor(6);
    app.handleKey({ name: "delete", char: "", ctrl: true, meta: false, shift: false });
    expect(app.input.getText()).toBe("alpha gamma");
    app.handleKey({ name: "right", char: "", ctrl: false, meta: true, shift: false });
    expect(app.input.getCursor()).toBe("alpha gamma".length);
    app.handleKey({ name: "left", char: "", ctrl: false, meta: false, shift: false, super: true });
    expect(app.input.getCursor()).toBe(0);
  });
});
