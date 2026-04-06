import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Keybindings {
  modelPicker: string;
  abort: string;
  submit: string;
  newline: string;
  deleteWord: string;
  deleteNextWord: string;
  toggleThinking: string;
  cycleScopedModel: string;
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  modelPicker: "ctrl+l",
  abort: "ctrl+c",
  submit: "return",
  newline: "shift+return",
  deleteWord: "ctrl+w",
  deleteNextWord: "ctrl+d",
  toggleThinking: "ctrl+t",
  cycleScopedModel: "ctrl+p",
};

let cached: Keybindings | null = null;

export function loadKeybindings(): Keybindings {
  if (cached) return cached;
  const file = join(homedir(), ".brokecli", "keybindings.json");
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf-8"));
      cached = { ...DEFAULT_KEYBINDINGS, ...raw };
    } catch {
      cached = { ...DEFAULT_KEYBINDINGS };
    }
  } else {
    cached = { ...DEFAULT_KEYBINDINGS };
  }
  return cached!;
}

export function getKeybinding(action: keyof Keybindings): string {
  return loadKeybindings()[action];
}

/** Check if a keypress matches a keybinding string like "ctrl+l" */
export function matchesBinding(binding: string, key: { name: string; ctrl: boolean; meta: boolean; shift: boolean }): boolean {
  const parts = binding.toLowerCase().split("+");
  const keyName = parts[parts.length - 1];
  const needCtrl = parts.includes("ctrl");
  const needMeta = parts.includes("meta") || parts.includes("alt");
  const needShift = parts.includes("shift");
  return key.name === keyName && key.ctrl === needCtrl && key.meta === needMeta && key.shift === needShift;
}
