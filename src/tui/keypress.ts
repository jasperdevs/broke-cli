import * as readline from "node:readline";
import { PASTE_MODE_ON, PASTE_MODE_OFF, MOUSE_ON, MOUSE_OFF, write } from "../utils/ansi.js";

export interface Keypress {
  name: string;       // "return", "backspace", "up", "down", "left", "right", "tab", "escape", or the char itself
  char: string;       // The actual character (empty for special keys)
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

type KeyHandler = (key: Keypress) => void;
type PasteHandler = (text: string) => void;

/**
 * Raw terminal input handler.
 * Uses Node's readline keypress parsing (works cross-platform).
 * Supports bracketed paste mode for multi-line pastes.
 */
export class KeypressHandler {
  private onKey: KeyHandler;
  private onPaste: PasteHandler;
  private isPasting = false;
  private pasteBuffer = "";

  constructor(onKey: KeyHandler, onPaste: PasteHandler) {
    this.onKey = onKey;
    this.onPaste = onPaste;
  }

  /** Start listening for input */
  start(): void {
    if (!process.stdin.isTTY) {
      throw new Error("brokecli requires an interactive terminal (TTY).");
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    // Enable bracketed paste and mouse tracking (scroll wheel)
    write(PASTE_MODE_ON);
    write(MOUSE_ON);

    // Track mouse sequences
    const mouseSeqRe = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let lastMouseTime = 0;

    // Intercept raw data BEFORE readline to handle mouse sequences
    const origEmit = process.stdin.emit.bind(process.stdin);
    process.stdin.emit = ((event: string, ...args: any[]) => {
      if (event === "data") {
        const s = typeof args[0] === "string" ? args[0] : (args[0] as Buffer).toString("utf-8");
        mouseSeqRe.lastIndex = 0;
        let match;
        let hasMouseData = false;
        while ((match = mouseSeqRe.exec(s)) !== null) {
          hasMouseData = true;
          lastMouseTime = Date.now();
          const button = parseInt(match[1], 10);
          const release = match[4] === "m";
          if (button === 64) {
            this.onKey({ name: "scrollup", char: "", ctrl: false, meta: false, shift: false });
          } else if (button === 65) {
            this.onKey({ name: "scrolldown", char: "", ctrl: false, meta: false, shift: false });
          } else if (button === 0 && release) {
            const col = parseInt(match[2], 10);
            const row = parseInt(match[3], 10);
            this.onKey({ name: "click", char: `${col},${row}`, ctrl: false, meta: false, shift: false });
          }
        }
        // If entire data was mouse sequences, don't pass to readline
        if (hasMouseData) {
          const stripped = s.replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, "");
          if (!stripped) return false;
          return origEmit("data", stripped);
        }
      }
      return origEmit(event, ...args);
    }) as typeof process.stdin.emit;

    // Use readline for keypress parsing (after our intercept)
    readline.emitKeypressEvents(process.stdin);

    process.stdin.on("keypress", (str: string | undefined, key: readline.Key) => {
      // Skip keypresses that are fragments of mouse escape sequences
      if (Date.now() - lastMouseTime < 10) return;
      if (str && /^\d+;?\d*[Mm]?$/.test(str)) return;
      if (str && str.startsWith("\x1b[<")) return;
      if (!key) return;

      // Bracketed paste detection
      if (str === "\x1b[200~") {
        this.isPasting = true;
        this.pasteBuffer = "";
        return;
      }
      if (str === "\x1b[201~") {
        this.isPasting = false;
        if (this.pasteBuffer) {
          this.onPaste(this.pasteBuffer);
          this.pasteBuffer = "";
        }
        return;
      }

      if (this.isPasting) {
        this.pasteBuffer += str ?? "";
        return;
      }

      // Normal keypress
      const kp: Keypress = {
        name: key.name ?? str ?? "",
        char: str ?? "",
        ctrl: key.ctrl ?? false,
        meta: key.meta ?? false,
        shift: key.shift ?? false,
      };

      this.onKey(kp);
    });
  }

  /** Stop listening, restore terminal */
  stop(): void {
    write(MOUSE_OFF);
    write(PASTE_MODE_OFF);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }
}
