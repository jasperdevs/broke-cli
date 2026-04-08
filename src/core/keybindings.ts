import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Keypress } from "../tui/keypress.js";

export interface Keybindings {
  modelPicker: string;
  treeView: string;
  abort: string;
  submit: string;
  newline: string;
  deleteWord: string;
  deleteNextWord: string;
  toggleThinking: string;
  cycleScopedModel: string;
  toggleMode: string;
}

export function detectEnhancedEnterSupport(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): boolean {
  const termProgram = (env.TERM_PROGRAM || "").toLowerCase();
  const term = (env.TERM || "").toLowerCase();
  if (termProgram.includes("wezterm") || termProgram.includes("ghostty") || termProgram.includes("vscode")) return true;
  if (platform === "darwin" && termProgram.includes("iterm")) return true;
  if (term.includes("kitty") || term.includes("wezterm") || term.includes("alacritty") || term.includes("xterm-kitty")) return true;
  return platform !== "win32";
}

export function getDefaultNewlineBinding(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  void env;
  void platform;
  return "shift+return";
}

export function applyKeybindingDefaults(
  raw: Partial<Keybindings> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): Keybindings {
  const defaultNewline = getDefaultNewlineBinding(env, platform);
  const savedNewline = raw?.newline?.trim().toLowerCase();
  const migratedNewline = raw?.newline;
  return {
    ...DEFAULT_KEYBINDINGS,
    ...raw,
    newline: migratedNewline ?? defaultNewline,
    // The tree hotkey is intentionally retired; keep /tree as the only entry point.
    treeView: DEFAULT_KEYBINDINGS.treeView,
  };
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  modelPicker: "ctrl+l",
  treeView: "",
  abort: "ctrl+c",
  submit: "return",
  newline: getDefaultNewlineBinding(),
  deleteWord: "ctrl+w",
  deleteNextWord: "ctrl+d",
  toggleThinking: "ctrl+t",
  cycleScopedModel: "ctrl+p",
  toggleMode: "tab",
};

let cached: Keybindings | null = null;

function getKeybindingsPath(): string {
  return join(homedir(), ".brokecli", "keybindings.json");
}

export function loadKeybindings(): Keybindings {
  if (cached) return cached;
  const file = getKeybindingsPath();
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf-8"));
      cached = applyKeybindingDefaults(raw);
    } catch {
      cached = applyKeybindingDefaults(undefined);
    }
  } else {
    cached = applyKeybindingDefaults(undefined);
  }
  return cached!;
}

export function reloadKeybindings(): void {
  cached = null;
}

export function getKeybinding(action: keyof Keybindings): string {
  return loadKeybindings()[action];
}

/** Check if a keypress matches a keybinding string like "ctrl+l" */
export function matchesBinding(binding: string, key: { name: string; ctrl: boolean; meta: boolean; shift: boolean }): boolean {
  if (!binding.trim()) return false;
  const parts = binding.toLowerCase().split("+");
  const keyName = parts[parts.length - 1];
  const needCtrl = parts.includes("ctrl");
  const needMeta = parts.includes("meta") || parts.includes("alt");
  const needShift = parts.includes("shift");
  return key.name === keyName && key.ctrl === needCtrl && key.meta === needMeta && key.shift === needShift;
}

export function formatKeypressBinding(key: Keypress): string | null {
  if (!key.name) return null;
  if (key.name === "click" || key.name === "scrollup" || key.name === "scrolldown") return null;
  if (key.name === "pageup" || key.name === "pagedown") return key.name;
  if (key.name === "escape") return "escape";
  if (key.name === "space") return "space";
  if (key.name === "linefeed") return "return";
  const parts: string[] = [];
  if (key.ctrl) parts.push("ctrl");
  if (key.meta) parts.push("alt");
  if (key.shift) parts.push("shift");
  parts.push(key.name.toLowerCase());
  return parts.join("+");
}

export function updateKeybinding(action: keyof Keybindings, binding: string): void {
  if (action === "treeView") return;
  const file = getKeybindingsPath();
  const dir = join(homedir(), ".brokecli");
  mkdirSync(dir, { recursive: true });
  const next = {
    ...loadKeybindings(),
    [action]: binding.trim(),
    treeView: DEFAULT_KEYBINDINGS.treeView,
  };
  writeFileSync(file, JSON.stringify(next, null, 2), "utf-8");
  cached = next;
}
