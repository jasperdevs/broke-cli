import type { Keypress } from "./keypress.js";

/**
 * Text input widget.
 * Handles cursor movement, character insertion/deletion, history.
 */
export class InputWidget {
  private text = "";
  private cursor = 0;
  private history: string[] = [];
  private historyIndex = -1;

  /** Get current input text */
  getText(): string { return this.text; }

  /** Get cursor position */
  getCursor(): number { return this.cursor; }

  /** Replace input text while preserving a valid cursor */
  setText(text: string, placeCursorAtEnd = true): void {
    this.text = text;
    this.cursor = placeCursorAtEnd ? this.text.length : Math.min(this.cursor, this.text.length);
  }

  /** Set cursor position directly, clamped to valid range */
  setCursor(cursor: number): void {
    this.cursor = Math.max(0, Math.min(cursor, this.text.length));
  }

  /** Clear input */
  clear(): void {
    this.text = "";
    this.cursor = 0;
    this.historyIndex = -1;
  }

  /** Submit current input, add to history, clear */
  submit(): string {
    const value = this.text.trim();
    if (value) {
      this.history.push(value);
    }
    this.clear();
    return value;
  }

  /** Insert pasted text */
  paste(text: string): void {
    this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
    this.cursor += text.length;
  }

  private deletePreviousWord(): void {
    if (this.cursor <= 0) return;
    let i = this.cursor;
    while (i > 0 && /\s/.test(this.text[i - 1])) i--;
    while (i > 0 && !/\s/.test(this.text[i - 1])) i--;
    this.text = this.text.slice(0, i) + this.text.slice(this.cursor);
    this.cursor = i;
  }

  /** Handle a keypress */
  handleKey(key: Keypress): "submit" | "interrupt" | "none" {
    // Ctrl+C — interrupt
    if (key.ctrl && key.name === "c") {
      return "interrupt";
    }

    // Shift+Enter / Alt+Enter / Ctrl+Enter / Ctrl+J — newline in input
    if (key.name === "linefeed"
      || (((key.shift || key.meta) && (key.name === "return" || key.name === "enter" || key.name === "linefeed"))
      || (key.ctrl && (key.name === "return" || key.name === "enter" || key.name === "linefeed" || key.name === "j")))) {
      this.text = this.text.slice(0, this.cursor) + "\n" + this.text.slice(this.cursor);
      this.cursor++;
      return "none";
    }

    // Enter — submit
    if (key.name === "return" || key.name === "enter") {
      return "submit";
    }

    // Plain Tab should never insert a raw tab character into the prompt.
    if (key.name === "tab") {
      return "none";
    }

    // Ctrl+U — clear line
    if (key.ctrl && key.name === "u") {
      this.clear();
      return "none";
    }

    // Ctrl+Backspace / Ctrl+W — delete previous word
    if ((key.ctrl && key.name === "backspace") || (key.ctrl && key.name === "w") || (key.ctrl && key.name === "h")) {
      this.deletePreviousWord();
      return "none";
    }

    // Backspace
    if (key.name === "backspace") {
      if (this.cursor > 0) {
        this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
        this.cursor--;
      }
      return "none";
    }

    // Delete
    if (key.name === "delete") {
      if (this.cursor < this.text.length) {
        this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
      }
      return "none";
    }

    // Arrow keys
    if (key.name === "left") {
      if (this.cursor > 0) this.cursor--;
      return "none";
    }
    if (key.name === "right") {
      if (this.cursor < this.text.length) this.cursor++;
      return "none";
    }

    // Home / Ctrl+A
    if (key.name === "home" || (key.ctrl && key.name === "a")) {
      this.cursor = 0;
      return "none";
    }

    // End / Ctrl+E
    if (key.name === "end" || (key.ctrl && key.name === "e")) {
      this.cursor = this.text.length;
      return "none";
    }

    // Up — history previous
    if (key.name === "up") {
      if (this.history.length > 0) {
        if (this.historyIndex === -1) {
          this.historyIndex = this.history.length - 1;
        } else if (this.historyIndex > 0) {
          this.historyIndex--;
        }
        this.text = this.history[this.historyIndex];
        this.cursor = this.text.length;
      }
      return "none";
    }

    // Down — history next
    if (key.name === "down") {
      if (this.historyIndex >= 0) {
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++;
          this.text = this.history[this.historyIndex];
        } else {
          this.historyIndex = -1;
          this.text = "";
        }
        this.cursor = this.text.length;
      }
      return "none";
    }

    // Alt+D — delete next word
    if (key.meta && key.name === "d") {
      if (this.cursor < this.text.length) {
        let i = this.cursor;
        while (i < this.text.length && this.text[i] === " ") i++;
        while (i < this.text.length && this.text[i] !== " ") i++;
        this.text = this.text.slice(0, this.cursor) + this.text.slice(i);
      }
      return "none";
    }

    // Ctrl+V or Ctrl+Shift+V — paste from clipboard
    if (key.ctrl && (key.name === "v" || (key.shift && key.name === "v"))) {
      try {
        const { execSync } = require("child_process");
        const clip = process.platform === "win32"
          ? execSync("powershell -command Get-Clipboard", { encoding: "utf-8" }).trim()
          : process.platform === "darwin"
            ? execSync("pbpaste", { encoding: "utf-8" }).trim()
            : execSync("xclip -selection clipboard -o", { encoding: "utf-8" }).trim();
        if (clip) this.paste(clip);
      } catch { /* clipboard unavailable */ }
      return "none";
    }

    // Regular character
    if (key.char && !key.ctrl && !key.meta && key.char.length === 1) {
      this.text = this.text.slice(0, this.cursor) + key.char + this.text.slice(this.cursor);
      this.cursor++;
      return "none";
    }

    return "none";
  }
}
