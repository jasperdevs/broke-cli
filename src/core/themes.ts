import { fg } from "../utils/ansi.js";

export interface Theme {
  primary: string;
  secondary: string;
  dim: string;
  error: string;
  warning: string;
  success: string;
  text: string;
  border: string;
  plan: string;
}

const theme: Theme = {
  primary: fg(58, 199, 58),
  secondary: fg(42, 154, 42),
  dim: fg(128, 128, 128),
  error: fg(255, 80, 80),
  warning: fg(255, 200, 50),
  success: fg(58, 199, 58),
  text: fg(255, 255, 255),
  border: fg(58, 199, 58),
  plan: fg(255, 200, 50),
};

export function currentTheme(): Theme {
  return theme;
}

export function getPlanColor(): string {
  return theme.plan;
}
