import type { Session, SessionBudgetMetrics } from "./session.js";

export interface BudgetReport {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTurns: number;
  avgTokensPerTurn: number;
  toolsExposed: number;
  toolsUsed: number;
  toolExposureWaste: number;
  idleCacheCliffs: number;
  autoCompactions: number;
  freshThreadCarryForwards: number;
  smallModelTurns: number;
  plannerCacheHits: number;
  plannerCacheMisses: number;
  topBleed: {
    key: string;
    value: number;
    pct: string;
  };
}

function pct(num: number, den: number): string {
  if (den <= 0 || num <= 0) return "0%";
  const value = (num / den) * 100;
  if (value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

function percentNumber(num: number, den: number): number {
  if (den <= 0 || num <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((num / den) * 100)));
}

function bar(value: number, max: number, width: number): string {
  if (width <= 0) return "";
  if (max <= 0 || value <= 0) return `${"░".repeat(width)}`;
  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.max(1, Math.round(ratio * width));
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

function panel(title: string, rows: string[], width: number): string[] {
  const inner = Math.max(12, width - 2);
  const head = `╭─ ${title} ${"─".repeat(Math.max(0, inner - title.length - 2))}╮`;
  const tail = `╰${"─".repeat(inner)}╯`;
  const body = rows.map((row) => `│${row.padEnd(inner)}│`);
  return [head, ...body, tail];
}

function joinColumns(left: string[], right: string[], leftWidth: number, rightWidth: number): string[] {
  const rowCount = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    lines.push(`${(left[i] ?? "").padEnd(leftWidth)}   ${(right[i] ?? "").padEnd(rightWidth)}`);
  }
  return lines;
}

export function buildBudgetReport(session: Session): BudgetReport {
  const metrics = session.getBudgetMetrics();
  const totalTurns = Math.max(metrics.totalTurns, 1);
  const toolExposureWaste = Math.max(0, metrics.toolsExposed - metrics.toolsUsed);
  const totalSessionTokens = session.getTotalTokens();
  const inputTokens = session.getTotalInputTokens();
  const outputTokens = session.getTotalOutputTokens();
  const totalTokenBase = Math.max(totalSessionTokens, 1);
  const avgTokensPerTurn = metrics.totalTurns > 0 ? Math.round(totalSessionTokens / metrics.totalTurns) : 0;

  const bleedCandidates = [
    { key: "tool waste", value: toolExposureWaste, den: Math.max(metrics.toolsExposed, 1) },
    { key: "planner miss", value: metrics.plannerCacheMisses, den: Math.max(metrics.plannerCacheHits + metrics.plannerCacheMisses, 1) },
    { key: "idle cliff", value: metrics.idleCacheCliffs, den: totalTurns },
    { key: "compact", value: metrics.autoCompactions, den: totalTurns },
  ].sort((a, b) => b.value - a.value || b.den - a.den)[0];

  return {
    totalTokens: totalSessionTokens,
    inputTokens,
    outputTokens,
    totalTurns: metrics.totalTurns,
    avgTokensPerTurn,
    toolsExposed: metrics.toolsExposed,
    toolsUsed: metrics.toolsUsed,
    toolExposureWaste,
    idleCacheCliffs: metrics.idleCacheCliffs,
    autoCompactions: metrics.autoCompactions,
    freshThreadCarryForwards: metrics.freshThreadCarryForwards,
    smallModelTurns: metrics.smallModelTurns,
    plannerCacheHits: metrics.plannerCacheHits,
    plannerCacheMisses: metrics.plannerCacheMisses,
    topBleed: {
      key: bleedCandidates.key,
      value: bleedCandidates.value,
      pct: pct(bleedCandidates.value, bleedCandidates.den),
    },
  };
}

export function renderBudgetDashboard(options: {
  report: BudgetReport;
  width: number;
  contextTokens?: number;
  contextLimit?: number;
}): string[] {
  const { report, width, contextTokens = 0, contextLimit = 0 } = options;
  const innerWidth = Math.max(36, width - 2);
  const chartWidth = Math.max(10, Math.min(22, Math.floor((innerWidth - 18) / 2)));
  const totalTokenBase = Math.max(report.totalTokens, 1);
  const totalTurns = Math.max(report.totalTurns, 1);
  const contextPct = contextLimit > 0 ? pct(contextTokens, contextLimit) : "0%";

  const sessionPanel = panel("Session", [
    `Σ ${report.totalTokens.toLocaleString()} total`,
    `↑ ${report.inputTokens.toLocaleString()} in   ${pct(report.inputTokens, totalTokenBase)}`,
    `↓ ${report.outputTokens.toLocaleString()} out  ${pct(report.outputTokens, totalTokenBase)}`,
    `${bar(report.inputTokens, totalTokenBase, chartWidth)} in`,
    `${bar(report.outputTokens, totalTokenBase, chartWidth)} out`,
    contextLimit > 0 ? `ctx ${contextTokens.toLocaleString()}/${contextLimit >= 1000 ? `${Math.round(contextLimit / 1000)}k` : contextLimit}` : "ctx n/a",
    contextLimit > 0 ? `${contextPct} of limit` : "limit n/a",
  ], Math.max(28, Math.floor((innerWidth - 3) / 2)));

  const bleedPanel = panel("Bleed", [
    `tool waste   ${report.toolExposureWaste.toString().padStart(5)}   ${pct(report.toolExposureWaste, Math.max(report.toolsExposed, 1))}`,
    `idle cliffs  ${report.idleCacheCliffs.toString().padStart(5)}   ${pct(report.idleCacheCliffs, totalTurns)}`,
    `plan misses  ${report.plannerCacheMisses.toString().padStart(5)}   ${pct(report.plannerCacheMisses, Math.max(report.plannerCacheHits + report.plannerCacheMisses, 1))}`,
    `compact      ${report.autoCompactions.toString().padStart(5)}   ${pct(report.autoCompactions, totalTurns)}`,
    `${bar(report.toolExposureWaste, Math.max(report.toolsExposed, 1), chartWidth)} tool`,
    `${bar(report.plannerCacheMisses, Math.max(report.plannerCacheHits + report.plannerCacheMisses, 1), chartWidth)} plan`,
  ], Math.max(28, Math.floor((innerWidth - 3) / 2)));

  const efficiencyPanel = panel("Efficiency", [
    `turns         ${report.totalTurns}`,
    `avg/turn      ${report.avgTokensPerTurn.toLocaleString()}`,
    `tools exp     ${report.toolsExposed}`,
    `tools used    ${report.toolsUsed}`,
    `carry         ${report.freshThreadCarryForwards}`,
  ], Math.max(28, Math.floor((innerWidth - 3) / 2)));

  const routingPanel = panel("Routing", [
    `small turns   ${report.smallModelTurns}   ${pct(report.smallModelTurns, totalTurns)}`,
    `plan hits     ${report.plannerCacheHits}`,
    `plan misses   ${report.plannerCacheMisses}`,
    `${bar(report.smallModelTurns, totalTurns, chartWidth)} small`,
    `top bleed     ${report.topBleed.key}`,
    `top value     ${report.topBleed.value}   ${report.topBleed.pct}`,
  ], Math.max(28, Math.floor((innerWidth - 3) / 2)));

  const isWide = innerWidth >= 88;
  const lines = isWide
    ? [
        ...joinColumns(sessionPanel, bleedPanel, sessionPanel[0].length, bleedPanel[0].length),
        "",
        ...joinColumns(efficiencyPanel, routingPanel, efficiencyPanel[0].length, routingPanel[0].length),
      ]
    : [...sessionPanel, "", ...bleedPanel, "", ...efficiencyPanel, "", ...routingPanel];

  return lines;
}

export function summarizeBudgetMetrics(metrics: SessionBudgetMetrics): string {
  const totalTurns = Math.max(metrics.totalTurns, 1);
  return `small ${pct(metrics.smallModelTurns, totalTurns)} · cliffs ${metrics.idleCacheCliffs} · tool waste ${Math.max(0, metrics.toolsExposed - metrics.toolsUsed)} · plan hits ${metrics.plannerCacheHits}`;
}
