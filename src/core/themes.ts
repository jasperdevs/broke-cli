import { bg, fg } from "../utils/ansi.js";
import { getSettings } from "./config.js";
import { THEME_PALETTES_A } from "./theme-palettes-a.js";
import { THEME_PALETTES_B } from "./theme-palettes-b.js";
import type { Theme, ThemePalette } from "./theme-types.js";

export type { Theme } from "./theme-types.js";

const PALETTES: ThemePalette[] = [...THEME_PALETTES_A, ...THEME_PALETTES_B];
const THEME_MAP = new Map<string, Theme>(PALETTES.map((palette) => [palette.key, toTheme(palette)]));

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
    background: palette.background ? bg(...palette.background) : "",
    text: fg(...palette.text),
    textMuted: fg(...palette.textMuted),
    border: fg(...palette.border),
    sidebarBorder: fg(...palette.sidebarBorder),
    plan: fg(...palette.plan),
    userBubble: bg(...palette.userBubble),
    userText: fg(...palette.userText),
    codeBg: bg(...palette.codeBg),
    diffAddBg: bg(...palette.diffAddBg),
    diffRemoveBg: bg(...palette.diffRemoveBg),
    imageTagBg: bg(...palette.imageTagBg),
  };
}

let previewThemeKey: string | null = null;

export function listThemes(): Theme[] {
  return [...THEME_MAP.values()];
}

export function getTheme(themeKey?: string | null): Theme {
  return THEME_MAP.get(themeKey ?? "") ?? THEME_MAP.get("brokecli-dark")!;
}

export function getThemeNames(): string[] {
  return listThemes().map((theme) => theme.key);
}

export function currentTheme(): Theme {
  return getTheme(previewThemeKey ?? getSettings().theme);
}

export function getPlanColor(): string {
  return currentTheme().plan;
}

export function setPreviewTheme(themeKey: string | null): void {
  previewThemeKey = themeKey;
}
