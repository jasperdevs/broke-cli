import type { Session, SessionBudgetMetrics } from "./session.js";

function pct(num: number, den: number): string {
  if (den <= 0 || num <= 0) return "0%";
  const value = (num / den) * 100;
  if (value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

export function buildBudgetReport(session: Session): string {
  const metrics = session.getBudgetMetrics();
  const totalTurns = Math.max(metrics.totalTurns, 1);
  const toolExposureWaste = Math.max(0, metrics.toolsExposed - metrics.toolsUsed);

  return [
    "Budget Insights",
    `Turns: ${metrics.totalTurns}`,
    `Small-model turns: ${metrics.smallModelTurns} (${pct(metrics.smallModelTurns, totalTurns)})`,
    `Idle cache cliffs: ${metrics.idleCacheCliffs}`,
    `Auto-compactions: ${metrics.autoCompactions}`,
    `Fresh carry-forwards: ${metrics.freshThreadCarryForwards}`,
    `Tools exposed: ${metrics.toolsExposed}`,
    `Tools used: ${metrics.toolsUsed}`,
    `Tool waste: ${toolExposureWaste}`,
    `Plan cache: ${metrics.plannerCacheHits} hits / ${metrics.plannerCacheMisses} misses`,
  ].join("\n");
}

export function summarizeBudgetMetrics(metrics: SessionBudgetMetrics): string {
  const totalTurns = Math.max(metrics.totalTurns, 1);
  return `small ${pct(metrics.smallModelTurns, totalTurns)} · cliffs ${metrics.idleCacheCliffs} · tool waste ${Math.max(0, metrics.toolsExposed - metrics.toolsUsed)} · plan hits ${metrics.plannerCacheHits}`;
}
