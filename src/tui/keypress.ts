import * as readline from "node:readline";
import {
  PASTE_MODE_ON,
  PASTE_MODE_OFF,
  MODIFY_OTHER_KEYS_ON,
  MODIFY_OTHER_KEYS_OFF,
  MENU_MOUSE_ON,
  MENU_MOUSE_OFF,
  write,
} from "../utils/ansi.js";

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
  private mouseTrackingEnabled = false;
  private started = false;
  private origEmit: typeof process.stdin.emit | null = null;
  private keypressListener: ((str: string | undefined, key: readline.Key) => void) | null = null;

  constructor(onKey: KeyHandler, onPaste: PasteHandler) {
    this.onKey = onKey;
    this.onPaste = onPaste;
  }

  /** Start listening for input */
  start(): void {
    if (this.started) return;
    if (!process.stdin.isTTY) {
      throw new Error("Interactive terminal (TTY) required.");
    }
    this.started = true;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    // Enable bracketed paste and mouse tracking (scroll wheel)
    write(PASTE_MODE_ON);
    write(MODIFY_OTHER_KEYS_ON);
    // Track mouse sequences
    const mouseSeqRe = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let lastMouseTime = 0;

    // Intercept raw data BEFORE readline to handle mouse sequences
    const origEmit = process.stdin.emit.bind(process.stdin);
    this.origEmit = origEmit;
    process.stdin.emit = ((event: string, ...args: any[]) => {
      if (event === "data") {
        const s = typeof args[0] === "string" ? args[0] : (args[0] as Buffer).toString("utf-8");
        const specialEnterSequences: Record<string, Keypress> = {
          "\x1b[13;2u": { name: "return", char: "", ctrl: false, meta: false, shift: true },
          "\x1b[10;2u": { name: "linefeed", char: "", ctrl: false, meta: false, shift: true },
          "\x1b[13;2~": { name: "return", char: "", ctrl: false, meta: false, shift: true },
          "\x1b[10;2~": { name: "linefeed", char: "", ctrl: false, meta: false, shift: true },
          "\x1b[27;2;13~": { name: "return", char: "", ctrl: false, meta: false, shift: true },
          "\x1b[27;13;2~": { name: "return", char: "", ctrl: false, meta: false, shift: true },
          "\x1b[13;5u": { name: "return", char: "", ctrl: true, meta: false, shift: false },
          "\x1b[10;5u": { name: "linefeed", char: "", ctrl: true, meta: false, shift: false },
          "\x1b[13;5~": { name: "return", char: "", ctrl: true, meta: false, shift: false },
          "\x1b[10;5~": { name: "linefeed", char: "", ctrl: true, meta: false, shift: false },
          "\x1b[13;3u": { name: "return", char: "", ctrl: false, meta: true, shift: false },
          "\x1b[10;3u": { name: "linefeed", char: "", ctrl: false, meta: true, shift: false },
          "\x1b[27;3;13~": { name: "return", char: "", ctrl: false, meta: true, shift: false },
          "\x1b\r": { name: "return", char: "", ctrl: false, meta: true, shift: false },
          "\x1b[127;5u": { name: "backspace", char: "", ctrl: true, meta: false, shift: false },
          "\x1b[8;5u": { name: "backspace", char: "", ctrl: true, meta: false, shift: false },
        };
        if (specialEnterSequences[s]) {
          this.onKey(specialEnterSequences[s]);
          return false;
        }
        if (s === "\x1b") {
          this.onKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
          return false;
        }
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

    this.keypressListener = (str: string | undefined, key: readline.Key) => {
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
      if ((str === "\n" || str === "\r\n") && !kp.ctrl && !kp.meta) {
        kp.name = "linefeed";
      }

      this.onKey(kp);
    };
    process.stdin.on("keypress", this.keypressListener);
  }

  /** Stop listening, restore terminal */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.setMouseTracking(false);
    write(MODIFY_OTHER_KEYS_OFF);
    write(PASTE_MODE_OFF);
    if (this.keypressListener) {
      process.stdin.off("keypress", this.keypressListener);
      this.keypressListener = null;
    }
    if (this.origEmit) {
      process.stdin.emit = this.origEmit;
      this.origEmit = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  setMouseTracking(enabled: boolean): void {
    if (this.mouseTrackingEnabled === enabled) return;
    write(enabled ? MENU_MOUSE_ON : MENU_MOUSE_OFF);
    this.mouseTrackingEnabled = enabled;
  }
}
