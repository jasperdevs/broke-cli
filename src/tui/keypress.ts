import * as readline from "node:readline";
import {
  PASTE_MODE_ON,
  PASTE_MODE_OFF,
  MODIFY_OTHER_KEYS_ON,
  MODIFY_OTHER_KEYS_OFF,
  KITTY_KEYBOARD_ON,
  KITTY_KEYBOARD_OFF,
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

function decodeModifiedKey(code: number, mod: number): Keypress | null {
  const shift = mod === 2 || mod === 4 || mod === 6 || mod === 8;
  const meta = mod === 3 || mod === 4 || mod === 7 || mod === 8;
  const ctrl = mod === 5 || mod === 6 || mod === 7 || mod === 8;
  if (code === 13) return { name: "return", char: "", ctrl, meta, shift };
  if (code === 10) return { name: "linefeed", char: "", ctrl, meta, shift };
  if (code === 8 || code === 127) return { name: "backspace", char: "", ctrl, meta, shift };
  return null;
}

export function decodeSpecialKeySequence(sequence: string): Keypress | null {
  const directMap: Record<string, Keypress> = {
    "\x1b\r": { name: "return", char: "", ctrl: false, meta: false, shift: true },
    "\x1b[13;2~": { name: "return", char: "", ctrl: false, meta: false, shift: true },
    "\x1b[10;2~": { name: "linefeed", char: "", ctrl: false, meta: false, shift: true },
    "\x1b\b": { name: "backspace", char: "", ctrl: false, meta: true, shift: false },
    "\x1b\x7f": { name: "backspace", char: "", ctrl: false, meta: true, shift: false },
  };
  if (directMap[sequence]) return directMap[sequence];

  const csiU = /^\x1b\[(\d+);(\d+)u$/u.exec(sequence);
  if (csiU) return decodeModifiedKey(parseInt(csiU[1], 10), parseInt(csiU[2], 10));

  const csiTilde = /^\x1b\[(\d+);(\d+)~$/u.exec(sequence);
  if (csiTilde) return decodeModifiedKey(parseInt(csiTilde[1], 10), parseInt(csiTilde[2], 10));

  const legacyTilde = /^\x1b\[27;(\d+);(\d+)~$/u.exec(sequence);
  if (legacyTilde) return decodeModifiedKey(parseInt(legacyTilde[2], 10), parseInt(legacyTilde[1], 10));

  const swappedLegacyTilde = /^\x1b\[27;(\d+);(\d+)u$/u.exec(sequence);
  if (swappedLegacyTilde) return decodeModifiedKey(parseInt(swappedLegacyTilde[2], 10), parseInt(swappedLegacyTilde[1], 10));

  const alternateLegacyTilde = /^\x1b\[(\d+);(\d+);27~$/u.exec(sequence);
  if (alternateLegacyTilde) return decodeModifiedKey(parseInt(alternateLegacyTilde[1], 10), parseInt(alternateLegacyTilde[2], 10));

  return null;
}

function looksLikeIncompleteEscapeSequence(sequence: string): boolean {
  if (!sequence.startsWith("\x1b")) return false;
  if (sequence === "\x1b") return true;
  if (/^\x1b\[[0-9;<>?]*$/u.test(sequence)) return true;
  if (/^\x1b\[M[\x00-\xff]{0,2}$/u.test(sequence)) return true;
  return false;
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
  private pendingEscapeSequence: string | null = null;
  private pendingEscapeTimer: NodeJS.Timeout | null = null;

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

    // Enable bracketed paste and mouse tracking.
    write(PASTE_MODE_ON);
    write(MODIFY_OTHER_KEYS_ON);
    write(KITTY_KEYBOARD_ON);
    // Track SGR and legacy X10 mouse sequences.
    const mouseSeqRe = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    const legacyMouseSeqRe = /\x1b\[M([\x00-\xff])([\x00-\xff])([\x00-\xff])/g;
    let lastMouseTime = 0;

    // Intercept raw data BEFORE readline to handle mouse sequences
    const origEmit = process.stdin.emit.bind(process.stdin);
    this.origEmit = origEmit;
    process.stdin.emit = ((event: string, ...args: any[]) => {
      if (event === "data") {
        let s = typeof args[0] === "string" ? args[0] : (args[0] as Buffer).toString("utf-8");
        if (this.pendingEscapeSequence) {
          s = `${this.pendingEscapeSequence}${s}`;
          this.pendingEscapeSequence = null;
          if (this.pendingEscapeTimer) {
            clearTimeout(this.pendingEscapeTimer);
            this.pendingEscapeTimer = null;
          }
        }
        const specialKey = decodeSpecialKeySequence(s);
        if (specialKey) {
          this.onKey(specialKey);
          return false;
        }
        if (looksLikeIncompleteEscapeSequence(s)) {
          this.pendingEscapeSequence = s;
          this.pendingEscapeTimer = setTimeout(() => {
            this.pendingEscapeSequence = null;
            this.pendingEscapeTimer = null;
            if (s === "\x1b") {
              this.onKey({ name: "escape", char: "", ctrl: false, meta: false, shift: false });
              return;
            }
            // Fall back to readline for sequences we could not complete in time.
            origEmit("data", s);
          }, 12);
          return false;
        }
        mouseSeqRe.lastIndex = 0;
        legacyMouseSeqRe.lastIndex = 0;
        let match;
        let hasMouseData = false;
        while ((match = mouseSeqRe.exec(s)) !== null) {
          hasMouseData = true;
          lastMouseTime = Date.now();
          const button = parseInt(match[1], 10);
          const col = parseInt(match[2], 10);
          const row = parseInt(match[3], 10);
          const release = match[4] === "m";
          if ((button & 64) === 64) {
            const wheelDown = (button & 1) === 1;
            this.onKey({ name: wheelDown ? "scrolldown" : "scrollup", char: `${col},${row}`, ctrl: false, meta: false, shift: false });
          } else if (button === 0 && release) {
            this.onKey({ name: "click", char: `${col},${row}`, ctrl: false, meta: false, shift: false });
          }
        }
        while ((match = legacyMouseSeqRe.exec(s)) !== null) {
          hasMouseData = true;
          lastMouseTime = Date.now();
          const button = match[1].charCodeAt(0) - 32;
          const col = match[2].charCodeAt(0) - 32;
          const row = match[3].charCodeAt(0) - 32;
          if ((button & 64) === 64) {
            const wheelDown = (button & 1) === 1;
            this.onKey({ name: wheelDown ? "scrolldown" : "scrollup", char: `${col},${row}`, ctrl: false, meta: false, shift: false });
          } else if ((button & 3) === 0) {
            this.onKey({ name: "click", char: `${col},${row}`, ctrl: false, meta: false, shift: false });
          }
        }
        // If entire data was mouse sequences, don't pass to readline
        if (hasMouseData) {
          const stripped = s
            .replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, "")
            .replace(/\x1b\[M[\x00-\xff][\x00-\xff][\x00-\xff]/g, "");
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
    write(KITTY_KEYBOARD_OFF);
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
    if (this.pendingEscapeTimer) {
      clearTimeout(this.pendingEscapeTimer);
      this.pendingEscapeTimer = null;
    }
    this.pendingEscapeSequence = null;
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
