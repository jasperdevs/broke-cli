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
  const totalTokenBase = Math.max(totalSessionTokens, 1);
  const inputTokens = session.getTotalInputTokens();
  const outputTokens = session.getTotalOutputTokens();
  const worstBleed = [
    {
      label: "Idle cliffs",
      value: metrics.idleCacheCliffs,
      hint: metrics.idleCacheCliffs > 0 ? "Long pauses break provider prompt caches. Compact or restart before the next big turn." : "No idle-cache cliff recorded in this session.",
    },
    {
      label: "Unused tools",
      value: toolExposureWaste,
      hint: toolExposureWaste > 0 ? "Tool schemas are being exposed more often than they are used. Narrow the tool set on simple turns." : "Tool exposure is tight so far.",
    },
    {
      label: "Planner misses",
      value: metrics.plannerCacheMisses,
      hint: metrics.plannerCacheMisses > 0 ? "Reusable scaffolds are missing on some turns. Similar tasks should get cheaper after reuse." : "Planner reuse is healthy so far.",
    },
  ].sort((a, b) => b.value - a.value)[0];

  const bar = (value: number, max: number, width = 18): string => {
    if (max <= 0 || value <= 0) return `${"░".repeat(width)} 0%`;
    const ratio = Math.max(0, Math.min(1, value / max));
    const filled = Math.max(1, Math.round(ratio * width));
    return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))} ${pct(value, max)}`;
  };

  return [
    "Budget",
    "",
    "Session",
    `  Σ ${totalSessionTokens.toLocaleString()} total`,
    `  ↑ ${inputTokens.toLocaleString()} in`,
    `  ↓ ${outputTokens.toLocaleString()} out`,
    `  ${bar(inputTokens, totalTokenBase)} input share`,
    `  ${bar(outputTokens, totalTokenBase)} output share`,
    "",
    "Bleed",
    `  ${bar(metrics.idleCacheCliffs, Math.max(metrics.totalTurns, 1))} idle cache cliffs`,
    `  ${bar(toolExposureWaste, Math.max(metrics.toolsExposed, 1))} unused tool exposure`,
    `  ${bar(metrics.plannerCacheMisses, Math.max(metrics.plannerCacheHits + metrics.plannerCacheMisses, 1))} planner misses`,
    `  ${bar(metrics.autoCompactions, Math.max(metrics.totalTurns, 1))} compactions`,
    "",
    "Efficiency",
    `  turns             ${metrics.totalTurns}`,
    `  avg tokens/turn   ${avgTokensPerTurn.toLocaleString()}`,
    `  tools exposed     ${metrics.toolsExposed} total (${avgToolsExposed}/turn)`,
    `  tools used        ${metrics.toolsUsed} total (${avgToolsUsed}/turn)`,
    `  carry-forwards    ${metrics.freshThreadCarryForwards}`,
    "",
    "Routing",
    `  ${bar(metrics.smallModelTurns, totalTurns)} small-model share`,
    `  plan cache        ${metrics.plannerCacheHits} hits / ${metrics.plannerCacheMisses} misses`,
    "",
    "Biggest bleed right now",
    `  ${worstBleed.label}: ${worstBleed.value}`,
    `  ${worstBleed.hint}`,
  ].join("\n");
}

export function summarizeBudgetMetrics(metrics: SessionBudgetMetrics): string {
  const totalTurns = Math.max(metrics.totalTurns, 1);
  return `small ${pct(metrics.smallModelTurns, totalTurns)} · cliffs ${metrics.idleCacheCliffs} · tool waste ${Math.max(0, metrics.toolsExposed - metrics.toolsUsed)} · plan hits ${metrics.plannerCacheHits}`;
}
