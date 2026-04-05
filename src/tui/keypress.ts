import * as readline from "node:readline";
import { PASTE_MODE_ON, PASTE_MODE_OFF, write } from "../utils/ansi.js";

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

    // Enable bracketed paste
    write(PASTE_MODE_ON);

    // Use readline for keypress parsing
    readline.emitKeypressEvents(process.stdin);

    process.stdin.on("keypress", (str: string | undefined, key: readline.Key) => {
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
    write(PASTE_MODE_OFF);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }
}
