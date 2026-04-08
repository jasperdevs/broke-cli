import { bg, fg } from "../utils/ansi.js";
import { getSettings } from "./config.js";
import type { Theme, ThemePalette } from "./theme-types.js";

export type { Theme } from "./theme-types.js";

const BASE_PALETTE: ThemePalette = {
  key: "brokecli",
  label: "Broke CLI",
  dark: true,
  primary: [102, 219, 124],
  secondary: [124, 175, 255],
  dim: [107, 111, 117],
  error: [255, 112, 112],
  warning: [240, 204, 92],
  success: [102, 219, 124],
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
  imageTagBg: [52, 56, 62],
};

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
  return [toTheme(BASE_PALETTE)];
}

export function currentTheme(): Theme {
  return toTheme(getModePalette());
}

export function getPlanColor(): string {
  return currentTheme().plan;
}
