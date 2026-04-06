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

function metric(label: string, value: string): string {
  return `${label.padEnd(18)} ${value}`;
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
  const chartWidth = Math.max(10, Math.min(26, Math.floor(innerWidth / 3)));
  const totalTokenBase = Math.max(report.totalTokens, 1);
  const totalTurns = Math.max(report.totalTurns, 1);
  const contextPct = contextLimit > 0 ? pct(contextTokens, contextLimit) : "0%";
  return [
    "BUDGET",
    "",
    "SESSION",
    metric("Σ total", report.totalTokens.toLocaleString()),
    metric("↑ input", `${report.inputTokens.toLocaleString()}  ${pct(report.inputTokens, totalTokenBase)}`),
    metric("↓ output", `${report.outputTokens.toLocaleString()}  ${pct(report.outputTokens, totalTokenBase)}`),
    metric("ctx", contextLimit > 0 ? `${contextTokens.toLocaleString()}/${contextLimit >= 1000 ? `${Math.round(contextLimit / 1000)}k` : contextLimit}` : "n/a"),
    metric("% limit", contextLimit > 0 ? contextPct : "n/a"),
    `${bar(report.inputTokens, totalTokenBase, chartWidth)} input`,
    `${bar(report.outputTokens, totalTokenBase, chartWidth)} output`,
    "",
    "BLEED",
    metric("tool waste", `${report.toolExposureWaste}  ${pct(report.toolExposureWaste, Math.max(report.toolsExposed, 1))}`),
    metric("idle cliffs", `${report.idleCacheCliffs}  ${pct(report.idleCacheCliffs, totalTurns)}`),
    metric("plan misses", `${report.plannerCacheMisses}  ${pct(report.plannerCacheMisses, Math.max(report.plannerCacheHits + report.plannerCacheMisses, 1))}`),
    metric("compactions", `${report.autoCompactions}  ${pct(report.autoCompactions, totalTurns)}`),
    `${bar(report.toolExposureWaste, Math.max(report.toolsExposed, 1), chartWidth)} tool`,
    `${bar(report.plannerCacheMisses, Math.max(report.plannerCacheHits + report.plannerCacheMisses, 1), chartWidth)} plan`,
    "",
    "EFFICIENCY",
    metric("turns", String(report.totalTurns)),
    metric("avg / turn", report.avgTokensPerTurn.toLocaleString()),
    metric("tools exposed", `${report.toolsExposed} (${(report.toolsExposed / totalTurns).toFixed(1)}/turn)`),
    metric("tools used", `${report.toolsUsed} (${(report.toolsUsed / totalTurns).toFixed(1)}/turn)`),
    metric("carry forwards", String(report.freshThreadCarryForwards)),
    "",
    "ROUTING",
    metric("small turns", `${report.smallModelTurns}  ${pct(report.smallModelTurns, totalTurns)}`),
    metric("plan hits", String(report.plannerCacheHits)),
    metric("plan misses", String(report.plannerCacheMisses)),
    metric("top bleed", `${report.topBleed.key}  ${report.topBleed.value}  ${report.topBleed.pct}`),
    `${bar(report.smallModelTurns, totalTurns, chartWidth)} small`,
  ];
}

export function summarizeBudgetMetrics(metrics: SessionBudgetMetrics): string {
  const totalTurns = Math.max(metrics.totalTurns, 1);
  return `small ${pct(metrics.smallModelTurns, totalTurns)} · cliffs ${metrics.idleCacheCliffs} · tool waste ${Math.max(0, metrics.toolsExposed - metrics.toolsUsed)} · plan hits ${metrics.plannerCacheHits}`;
}
