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
  const totalSessionTokens = session.getTotalTokens();
  const avgTokensPerTurn = metrics.totalTurns > 0 ? Math.round(totalSessionTokens / metrics.totalTurns) : 0;
  const avgToolsExposed = metrics.totalTurns > 0 ? (metrics.toolsExposed / metrics.totalTurns).toFixed(1) : "0.0";
  const avgToolsUsed = metrics.totalTurns > 0 ? (metrics.toolsUsed / metrics.totalTurns).toFixed(1) : "0.0";

  return [
    "Token Budget",
    "",
    `Session total: ${totalSessionTokens} tokens`,
    `Turns: ${metrics.totalTurns}`,
    `Avg per turn: ${avgTokensPerTurn} tokens`,
    "",
    "Bleed signals",
    `Idle cache cliffs: ${metrics.idleCacheCliffs}`,
    `Auto-compactions: ${metrics.autoCompactions}`,
    `Fresh carry-forwards: ${metrics.freshThreadCarryForwards}`,
    "",
    "Tool pressure",
    `Exposed tools: ${metrics.toolsExposed} total (${avgToolsExposed}/turn)`,
    `Used tools: ${metrics.toolsUsed} total (${avgToolsUsed}/turn)`,
    `Exposed but unused: ${toolExposureWaste}`,
    "",
    "Routing",
    `Small-model turns: ${metrics.smallModelTurns} (${pct(metrics.smallModelTurns, totalTurns)})`,
    `Plan cache: ${metrics.plannerCacheHits} hits / ${metrics.plannerCacheMisses} misses`,
    "",
    "Hint: minimize idle cliffs, keep tool surfaces narrow, and compact before long follow-up turns.",
  ].join("\n");
}

export function summarizeBudgetMetrics(metrics: SessionBudgetMetrics): string {
  const totalTurns = Math.max(metrics.totalTurns, 1);
  return `small ${pct(metrics.smallModelTurns, totalTurns)} · cliffs ${metrics.idleCacheCliffs} · tool waste ${Math.max(0, metrics.toolsExposed - metrics.toolsUsed)} · plan hits ${metrics.plannerCacheHits}`;
}
