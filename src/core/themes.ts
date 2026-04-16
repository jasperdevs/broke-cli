import { execFileSync } from "child_process";
import { fg } from "../utils/ansi.js";
import { getSettings } from "./config.js";
import type { Theme, ThemePalette } from "./theme-types.js";

export type { Theme } from "./theme-types.js";

const AUTO_DARK_PALETTE: ThemePalette = {
  key: "automatic",
  label: "Automatic",
  dark: true,
  primary: [57, 193, 57],
  secondary: [57, 193, 57],
  dim: [107, 111, 117],
  error: [255, 112, 112],
  warning: [240, 204, 92],
  success: [57, 193, 57],
  background: null,
  text: [233, 236, 239],
  textMuted: [149, 153, 159],
  border: [58, 62, 68],
  sidebarBorder: [48, 52, 57],
  plan: [240, 204, 92],
  userBubble: [28, 28, 28],
  userText: [239, 241, 243],
  codeBg: [24, 24, 24],
  diffAddBg: [24, 50, 31],
  diffRemoveBg: [70, 30, 30],
  imageTagBg: [40, 145, 40],
};

const AUTO_LIGHT_PALETTE: ThemePalette = {
  ...AUTO_DARK_PALETTE,
  dark: false,
  text: [28, 30, 34],
  textMuted: [91, 97, 106],
  dim: [103, 109, 118],
  border: [186, 190, 198],
  sidebarBorder: [196, 200, 207],
  userText: [24, 26, 29],
};

const runtimeThemes = new Map<string, ThemePalette>();
let cachedDarkMode: { value: boolean; checkedAt: number } | null = null;

function mixRgb(a: [number, number, number], b: [number, number, number], ratio: number): [number, number, number] {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return [
    clamp(a[0] * (1 - ratio) + b[0] * ratio),
    clamp(a[1] * (1 - ratio) + b[1] * ratio),
    clamp(a[2] * (1 - ratio) + b[2] * ratio),
  ];
}

function getModePalette(): ThemePalette {
  return applyPlanTint(getAutomaticPalette());
}

function applyPlanTint(palette: ThemePalette): ThemePalette {
  if (getSettings().mode !== "plan") return palette;
  const planAccent = mixRgb(palette.primary, [240, 204, 92], palette.dark ? 0.55 : 0.35);
  return {
    ...palette,
    primary: planAccent,
    secondary: mixRgb(palette.secondary, [250, 222, 142], palette.dark ? 0.45 : 0.3),
    warning: mixRgb(palette.warning, [250, 222, 142], palette.dark ? 0.4 : 0.25),
    success: mixRgb(palette.success, [240, 204, 92], palette.dark ? 0.35 : 0.2),
    textMuted: mixRgb(palette.textMuted, [191, 174, 119], palette.dark ? 0.35 : 0.2),
    border: mixRgb(palette.border, [92, 78, 39], palette.dark ? 0.4 : 0.25),
    sidebarBorder: mixRgb(palette.sidebarBorder, [82, 69, 35], palette.dark ? 0.35 : 0.2),
    background: null,
    userBubble: mixRgb(palette.userBubble, [32, 29, 23], palette.dark ? 0.25 : 0.1),
    codeBg: mixRgb(palette.codeBg, [34, 31, 24], palette.dark ? 0.22 : 0.1),
    imageTagBg: mixRgb(palette.imageTagBg, [72, 62, 34], palette.dark ? 0.28 : 0.18),
    plan: planAccent,
  };
}

function toTheme(palette: ThemePalette): Theme {
  return {
    key: palette.key,
    label: palette.label,
    dark: palette.dark,
    primary: fg(...palette.primary),
    secondary: fg(...palette.secondary),
    dim: fg(...palette.dim),
    error: fg(...palette.error),
    warning: fg(...palette.warning),
    success: fg(...palette.success),
    background: "",
    text: fg(...palette.text),
    textMuted: fg(...palette.textMuted),
    border: fg(...palette.border),
    sidebarBorder: fg(...palette.sidebarBorder),
    sidebarBackground: "",
    plan: fg(...palette.plan),
    userBubble: "",
    userText: fg(...palette.userText),
    codeBg: "",
    diffAddBg: "",
    diffRemoveBg: "",
    imageTagBg: "",
  };
}

export function listThemes(): Theme[] {
  return [];
}

export function currentTheme(): Theme {
  return toTheme(getModePalette());
}

export function getPlanColor(): string {
  return currentTheme().plan;
}

export function registerThemePalettes(palettes: ThemePalette[]): void {
  for (const palette of palettes) {
    if (!palette?.key || !palette?.label) continue;
    runtimeThemes.set(palette.key, palette);
  }
}

export function clearRegisteredThemes(): void {
  runtimeThemes.clear();
}

export function getThemePalette(key: string): ThemePalette | null {
  if (key === "automatic" || key === "brokecli") return getModePalette();
  if (runtimeThemes.has(key)) return runtimeThemes.get(key) ?? null;
  return null;
}

function getAutomaticPalette(): ThemePalette {
  return detectDarkMode() ? AUTO_DARK_PALETTE : AUTO_LIGHT_PALETTE;
}

function detectDarkMode(): boolean {
  const now = Date.now();
  if (cachedDarkMode && now - cachedDarkMode.checkedAt < 30_000) return cachedDarkMode.value;
  const value = detectDarkModeUncached();
  cachedDarkMode = { value, checkedAt: now };
  return value;
}

function detectDarkModeUncached(): boolean {
  const forced = (process.env.BROKECLI_COLOR_SCHEME || process.env.BROKECLI_THEME || "").trim().toLowerCase();
  if (forced === "light") return false;
  if (forced === "dark") return true;

  const colorFgBg = process.env.COLORFGBG;
  const bgCode = colorFgBg?.match(/(?:^|;)(\d+)$/)?.[1];
  if (bgCode != null) return Number(bgCode) < 7;

  if (process.platform === "win32") {
    try {
      const out = execFileSync("reg", [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        "/v",
        "AppsUseLightTheme",
      ], { encoding: "utf-8", timeout: 250 });
      const match = out.match(/AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i);
      if (match) return parseInt(match[1]!, 16) === 0;
    } catch {
      return true;
    }
  }

  if (process.platform === "darwin") {
    try {
      const out = execFileSync("defaults", ["read", "-g", "AppleInterfaceStyle"], { encoding: "utf-8", timeout: 250 });
      return out.trim().toLowerCase() === "dark";
    } catch {
      return false;
    }
  }

  try {
    const out = execFileSync("gsettings", ["get", "org.gnome.desktop.interface", "color-scheme"], { encoding: "utf-8", timeout: 250 });
    if (out.toLowerCase().includes("prefer-light")) return false;
    if (out.toLowerCase().includes("prefer-dark")) return true;
  } catch {
    return true;
  }
  return true;
}
