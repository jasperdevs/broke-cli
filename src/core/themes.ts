import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { fg } from "../utils/ansi.js";
import { getSettings } from "./config.js";

export interface Theme {
  primary: string;
  secondary: string;
  dim: string;
  error: string;
  warning: string;
  success: string;
  text: string;
  border: string;
  /** Color used in plan mode (defaults to warning if not set) */
  plan?: string;
}

const dark: Theme = {
  primary: fg(58, 199, 58),     // green — matches existing GREEN
  secondary: fg(42, 154, 42),   // dimmer green
  dim: fg(128, 128, 128),
  error: fg(255, 80, 80),
  warning: fg(255, 200, 50),
  success: fg(58, 199, 58),
  text: fg(255, 255, 255),
  border: fg(58, 199, 58),
  plan: fg(255, 200, 50),       // yellow for plan mode
};

const light: Theme = {
  primary: fg(30, 120, 220),
  secondary: fg(60, 90, 180),
  dim: fg(100, 100, 100),
  error: fg(200, 40, 40),
  warning: fg(180, 140, 20),
  success: fg(30, 160, 60),
  text: fg(40, 40, 40),
  border: fg(30, 120, 220),
  plan: fg(200, 150, 20),      // amber for plan mode
};

const dracula: Theme = {
  primary: fg(189, 147, 249),   // purple
  secondary: fg(139, 233, 253), // cyan
  dim: fg(98, 114, 164),
  error: fg(255, 85, 85),
  warning: fg(241, 250, 140),
  success: fg(80, 250, 123),
  text: fg(248, 248, 242),
  border: fg(189, 147, 249),
  plan: fg(255, 184, 108),      // orange for plan mode
};

const monokai: Theme = {
  primary: fg(166, 226, 46),    // green
  secondary: fg(253, 151, 31),  // orange
  dim: fg(117, 113, 94),
  error: fg(249, 38, 114),
  warning: fg(230, 219, 116),
  success: fg(166, 226, 46),
  text: fg(248, 248, 242),
  border: fg(166, 226, 46),
  plan: fg(230, 219, 116),      // yellow for plan mode
};

const BUILTIN_THEMES: Record<string, Theme> = {
  "brokecli-dark": dark,
  "brokecli-light": light,
  dracula,
  monokai,
};

/** Convert a hex color (#rrggbb) to an ANSI true-color fg sequence. */
function hexToFg(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return fg(255, 255, 255);
  return fg(r, g, b);
}

const THEME_KEYS: (keyof Theme)[] = [
  "primary", "secondary", "dim", "error", "warning", "success", "text", "border", "plan",
];

function loadCustomThemes(): Record<string, Theme> {
  const dir = join(homedir(), ".brokecli", "themes");
  if (!existsSync(dir)) return {};
  const result: Record<string, Theme> = {};
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
        const theme = { ...dark }; // start from dark as base
        for (const key of THEME_KEYS) {
          if (typeof raw[key] === "string") {
            theme[key] = hexToFg(raw[key]);
          }
        }
        const name = file.replace(/\.json$/, "");
        result[name] = theme;
      } catch { /* skip malformed files */ }
    }
  } catch { /* dir unreadable */ }
  return result;
}

export function getTheme(name: string): Theme {
  if (BUILTIN_THEMES[name]) return BUILTIN_THEMES[name];
  const custom = loadCustomThemes();
  if (custom[name]) return custom[name];
  return dark;
}

export function listThemes(): string[] {
  const custom = loadCustomThemes();
  return [...Object.keys(BUILTIN_THEMES), ...Object.keys(custom)];
}

export function currentTheme(): Theme {
  const settings = getSettings();
  return getTheme(settings.theme);
}

export function getPlanColor(): string {
  const theme = currentTheme();
  return theme.plan ?? theme.warning;
}
