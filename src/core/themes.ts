import { bg, fg } from "../utils/ansi.js";
import { getSettings } from "./config.js";
import type { Theme, ThemePalette } from "./theme-types.js";
import { THEME_PALETTES_A } from "./theme-palettes-a.js";
import { THEME_PALETTES_B } from "./theme-palettes-b.js";
import {
  listThemes as listThemeResources,
  loadThemePalette as loadConfiguredThemePalette,
} from "./resources.js";

export type { Theme } from "./theme-types.js";

const BASE_PALETTE: ThemePalette = {
  key: "brokecli",
  label: "Broke CLI",
  dark: true,
  primary: [57, 193, 57],
  secondary: [57, 193, 57],
  dim: [107, 111, 117],
  error: [255, 112, 112],
  warning: [240, 204, 92],
  success: [57, 193, 57],
  background: [20, 20, 20],
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

const runtimeThemes = new Map<string, ThemePalette>();

function mixRgb(a: [number, number, number], b: [number, number, number], ratio: number): [number, number, number] {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return [
    clamp(a[0] * (1 - ratio) + b[0] * ratio),
    clamp(a[1] * (1 - ratio) + b[1] * ratio),
    clamp(a[2] * (1 - ratio) + b[2] * ratio),
  ];
}

function getModePalette(): ThemePalette {
  if (getSettings().mode !== "plan") return BASE_PALETTE;
  return {
    ...BASE_PALETTE,
    primary: [240, 204, 92],
    secondary: [250, 222, 142],
    dim: [148, 131, 74],
    warning: [250, 222, 142],
    success: [240, 204, 92],
    textMuted: [191, 174, 119],
    border: [92, 78, 39],
    sidebarBorder: [82, 69, 35],
    background: [27, 24, 18],
    userBubble: [32, 29, 23],
    codeBg: [34, 31, 24],
    imageTagBg: [72, 62, 34],
  };
}

function applyPlanTint(palette: ThemePalette): ThemePalette {
  if (getSettings().mode !== "plan") return palette;
  return {
    ...palette,
    primary: mixRgb(palette.primary, [240, 204, 92], palette.dark ? 0.55 : 0.35),
    secondary: mixRgb(palette.secondary, [250, 222, 142], palette.dark ? 0.45 : 0.3),
    warning: mixRgb(palette.warning, [250, 222, 142], palette.dark ? 0.4 : 0.25),
    success: mixRgb(palette.success, [240, 204, 92], palette.dark ? 0.35 : 0.2),
    textMuted: mixRgb(palette.textMuted, [191, 174, 119], palette.dark ? 0.35 : 0.2),
    border: mixRgb(palette.border, [92, 78, 39], palette.dark ? 0.4 : 0.25),
    sidebarBorder: mixRgb(palette.sidebarBorder, [82, 69, 35], palette.dark ? 0.35 : 0.2),
    background: palette.background ? mixRgb(palette.background, [27, 24, 18], palette.dark ? 0.28 : 0.12) : palette.background,
    userBubble: mixRgb(palette.userBubble, [32, 29, 23], palette.dark ? 0.25 : 0.1),
    codeBg: mixRgb(palette.codeBg, [34, 31, 24], palette.dark ? 0.22 : 0.1),
    imageTagBg: mixRgb(palette.imageTagBg, [72, 62, 34], palette.dark ? 0.28 : 0.18),
    plan: mixRgb(palette.plan, [240, 204, 92], 0.4),
  };
}

function toTheme(palette: ThemePalette): Theme {
  const sidebarBase = palette.background ?? palette.userBubble;
  const sidebarBackground = mixRgb(sidebarBase, palette.sidebarBorder, palette.dark ? 0.14 : 0.08);
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
    sidebarBackground: bg(...sidebarBackground),
    plan: fg(...palette.plan),
    userBubble: bg(...palette.userBubble),
    userText: fg(...palette.userText),
    codeBg: bg(...palette.codeBg),
    diffAddBg: bg(...palette.diffAddBg),
    diffRemoveBg: bg(...palette.diffRemoveBg),
    imageTagBg: bg(...palette.imageTagBg),
  };
}

export function listThemes(): Theme[] {
  const palettes = new Map<string, ThemePalette>();
  for (const palette of [BASE_PALETTE, ...THEME_PALETTES_A, ...THEME_PALETTES_B]) palettes.set(palette.key, palette);
  for (const palette of runtimeThemes.values()) palettes.set(palette.key, palette);
  for (const resource of listThemeResources()) {
    const palette = loadConfiguredThemePalette(resource.key);
    if (palette) palettes.set(palette.key, palette);
  }
  return [...palettes.values()].map(toTheme).sort((a, b) => a.label.localeCompare(b.label));
}

export function currentTheme(): Theme {
  const configuredKey = getSettings().theme?.trim();
  if (configuredKey) {
    const selected = getThemePalette(configuredKey);
    if (selected) return toTheme(applyPlanTint(selected));
  }
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
  if (key === BASE_PALETTE.key) return getModePalette();
  if (runtimeThemes.has(key)) return runtimeThemes.get(key) ?? null;
  const builtIn = [...THEME_PALETTES_A, ...THEME_PALETTES_B].find((palette) => palette.key === key);
  if (builtIn) return builtIn;
  return loadConfiguredThemePalette(key);
}
