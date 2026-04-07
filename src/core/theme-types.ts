export type Rgb = [number, number, number];

export interface ThemePalette {
  key: string;
  label: string;
  dark: boolean;
  primary: Rgb;
  secondary: Rgb;
  dim: Rgb;
  error: Rgb;
  warning: Rgb;
  success: Rgb;
  background?: Rgb | null;
  text: Rgb;
  textMuted: Rgb;
  border: Rgb;
  sidebarBorder: Rgb;
  plan: Rgb;
  userBubble: Rgb;
  userText: Rgb;
  codeBg: Rgb;
  diffAddBg: Rgb;
  diffRemoveBg: Rgb;
  imageTagBg: Rgb;
}

export interface Theme {
  key: string;
  label: string;
  dark: boolean;
  primary: string;
  secondary: string;
  dim: string;
  error: string;
  warning: string;
  success: string;
  background: string;
  text: string;
  textMuted: string;
  border: string;
  sidebarBorder: string;
  sidebarBackground: string;
  plan: string;
  userBubble: string;
  userText: string;
  codeBg: string;
  diffAddBg: string;
  diffRemoveBg: string;
  imageTagBg: string;
}
