import { GREEN, GRAY, RESET, BOLD, DIM } from "../utils/ansi.js";

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
  const left = `${GREEN}${BOLD} brokecli${RESET} ${GRAY}│${RESET} ${state.provider}/${state.model}`;
  const streaming = state.isStreaming ? ` ${GREEN}●${RESET}` : "";
  const right = `${GREEN}${formatCost(state.cost)}${RESET} ${GRAY}│${RESET} ${formatTokens(state.tokens)} tok${streaming} `;

  // The actual visible characters (without ANSI) determine padding
  // For now just concat — proper width calculation comes with strip-ansi
  return `${left}${GRAY}${" ".repeat(Math.max(1, 10))}${RESET}${right}`;
}
