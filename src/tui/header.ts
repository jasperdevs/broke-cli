import { RESET, BOLD } from "../utils/ansi.js";
import { currentTheme } from "../core/themes.js";

export interface HeaderState {
  model: string;
  provider: string;
  cost: number;
  tokens: number;
  isStreaming: boolean;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Render the header bar as a single string */
export function renderHeader(state: HeaderState, width: number): string {
  const theme = currentTheme();
  const left = `${theme.primary}${BOLD} brokecli${RESET} ${theme.border}│${RESET} ${theme.text}${state.provider}/${state.model}${RESET}`;
  const streaming = state.isStreaming ? ` ${theme.success}*${RESET}` : "";
  const right = `${theme.primary}${formatCost(state.cost)}${RESET} ${theme.border}│${RESET} ${theme.textMuted}${formatTokens(state.tokens)} tok${streaming} ${RESET}`;

  // The actual visible characters (without ANSI) determine padding
  // For now just concat — proper width calculation comes with strip-ansi
  return `${left}${theme.border}${" ".repeat(Math.max(1, 10))}${RESET}${right}`;
}
