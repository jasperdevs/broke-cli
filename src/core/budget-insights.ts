import type { Session, SessionBudgetMetrics } from "./session.js";

export interface BudgetReport {
  sessionCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  plannerTokens: number;
  plannerInputTokens: number;
  plannerOutputTokens: number;
  executorTokens: number;
  executorInputTokens: number;
  executorOutputTokens: number;
  totalTurns: number;
  avgTokensPerTurn: number;
  toolsExposed: number;
  toolsUsed: number;
  toolExposureWaste: number;
  shellRecoveries: number;
  toolOutputTokens: Record<string, number>;
  toolCallsByName: Record<string, number>;
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
  topToolBleeds: Array<{
    tool: string;
    tokens: number;
    calls: number;
  }>;
}

function pct(num: number, den: number): string {
  if (den <= 0 || num <= 0) return "0%";
  const value = (num / den) * 100;
  if (value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

function bar(value: number, max: number, width: number): string {
  if (width <= 0) return "";
  if (max <= 0 || value <= 0) return "░".repeat(width);
  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.max(1, Math.round(ratio * width));
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

function metric(label: string, value: string): string {
  return `${label.padEnd(16)} ${value}`;
}

function emptyMetrics(): SessionBudgetMetrics {
  return {
    totalTurns: 0,
    smallModelTurns: 0,
    idleCacheCliffs: 0,
    autoCompactions: 0,
    freshThreadCarryForwards: 0,
    toolsExposed: 0,
    toolsUsed: 0,
    shellRecoveries: 0,
    toolOutputTokens: {},
    toolCallsByName: {},
    plannerCacheHits: 0,
    plannerCacheMisses: 0,
    plannerInputTokens: 0,
    plannerOutputTokens: 0,
    executorInputTokens: 0,
    executorOutputTokens: 0,
  };
}

function mergeBudgetMetrics(metricsList: SessionBudgetMetrics[]): SessionBudgetMetrics {
  const merged = emptyMetrics();
  for (const metrics of metricsList) {
    merged.totalTurns += metrics.totalTurns;
    merged.smallModelTurns += metrics.smallModelTurns;
    merged.idleCacheCliffs += metrics.idleCacheCliffs;
    merged.autoCompactions += metrics.autoCompactions;
    merged.freshThreadCarryForwards += metrics.freshThreadCarryForwards;
    merged.toolsExposed += metrics.toolsExposed;
    merged.toolsUsed += metrics.toolsUsed;
    merged.shellRecoveries += metrics.shellRecoveries;
    for (const [tool, tokens] of Object.entries(metrics.toolOutputTokens ?? {})) {
      merged.toolOutputTokens[tool] = (merged.toolOutputTokens[tool] ?? 0) + tokens;
    }
    for (const [tool, calls] of Object.entries(metrics.toolCallsByName ?? {})) {
      merged.toolCallsByName[tool] = (merged.toolCallsByName[tool] ?? 0) + calls;
    }
    merged.plannerCacheHits += metrics.plannerCacheHits;
    merged.plannerCacheMisses += metrics.plannerCacheMisses;
    merged.plannerInputTokens += metrics.plannerInputTokens;
    merged.plannerOutputTokens += metrics.plannerOutputTokens;
    merged.executorInputTokens += metrics.executorInputTokens;
    merged.executorOutputTokens += metrics.executorOutputTokens;
  }
  return merged;
}

function buildBudgetReportFromParts(parts: {
  sessionCount: number;
  metrics: SessionBudgetMetrics;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}): BudgetReport {
  const metrics = parts.metrics;
  const totalTurns = Math.max(metrics.totalTurns, 1);
  const toolExposureWaste = Math.max(0, metrics.toolsExposed - metrics.toolsUsed);
  const totalTokenBase = Math.max(parts.totalTokens, 1);
  const avgTokensPerTurn = metrics.totalTurns > 0 ? Math.round(parts.totalTokens / metrics.totalTurns) : 0;
  const plannerTokens = metrics.plannerInputTokens + metrics.plannerOutputTokens;
  const executorTokens = metrics.executorInputTokens + metrics.executorOutputTokens;
  const bleedCandidates = [
    { key: "tool waste", value: toolExposureWaste, den: Math.max(metrics.toolsExposed, 1) },
    { key: "planner miss", value: metrics.plannerCacheMisses, den: Math.max(metrics.plannerCacheHits + metrics.plannerCacheMisses, 1) },
    { key: "idle cliff", value: metrics.idleCacheCliffs, den: totalTurns },
    { key: "compact", value: metrics.autoCompactions, den: totalTurns },
  ].sort((a, b) => b.value - a.value || b.den - a.den)[0];
  const topToolBleeds = Object.entries(metrics.toolOutputTokens ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([tool, tokens]) => ({
      tool,
      tokens,
      calls: metrics.toolCallsByName?.[tool] ?? 0,
    }));

  return {
    sessionCount: parts.sessionCount,
    totalTokens: parts.totalTokens,
    inputTokens: parts.inputTokens,
    outputTokens: parts.outputTokens,
    plannerTokens,
    plannerInputTokens: metrics.plannerInputTokens,
    plannerOutputTokens: metrics.plannerOutputTokens,
    executorTokens,
    executorInputTokens: metrics.executorInputTokens,
    executorOutputTokens: metrics.executorOutputTokens,
    totalTurns: metrics.totalTurns,
    avgTokensPerTurn,
    toolsExposed: metrics.toolsExposed,
    toolsUsed: metrics.toolsUsed,
    toolExposureWaste,
    shellRecoveries: metrics.shellRecoveries,
    toolOutputTokens: { ...(metrics.toolOutputTokens ?? {}) },
    toolCallsByName: { ...(metrics.toolCallsByName ?? {}) },
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
    topToolBleeds,
  };
}

export function buildBudgetReport(session: Session): BudgetReport {
  return buildBudgetReportFromParts({
    sessionCount: 1,
    metrics: session.getBudgetMetrics(),
    totalTokens: session.getTotalTokens(),
    inputTokens: session.getTotalInputTokens(),
    outputTokens: session.getTotalOutputTokens(),
  });
}

export function buildAggregateBudgetReport(sessions: Session[]): BudgetReport {
  return buildBudgetReportFromParts({
    sessionCount: sessions.length,
    metrics: mergeBudgetMetrics(sessions.map((session) => session.getBudgetMetrics())),
    totalTokens: sessions.reduce((sum, session) => sum + session.getTotalTokens(), 0),
    inputTokens: sessions.reduce((sum, session) => sum + session.getTotalInputTokens(), 0),
    outputTokens: sessions.reduce((sum, session) => sum + session.getTotalOutputTokens(), 0),
  });
}

export function renderBudgetDashboard(options: {
  report: BudgetReport;
  width: number;
  scopeLabel: string;
  contextTokens?: number;
  contextLimit?: number;
  showContext?: boolean;
}): string[] {
  const { report, width, scopeLabel, contextTokens = 0, contextLimit = 0, showContext = false } = options;
  const innerWidth = Math.max(40, width - 2);
  const chartWidth = Math.max(12, Math.min(28, Math.floor(innerWidth / 3)));
  const totalTokenBase = Math.max(report.totalTokens, 1);
  const totalTurns = Math.max(report.totalTurns, 1);
  const lines: string[] = [
    "BUDGET",
    metric("scope", scopeLabel),
    metric("sessions", report.sessionCount.toLocaleString()),
    "",
    "TOKENS",
    metric("Σ total", report.totalTokens.toLocaleString()),
    metric("↑ input", `${report.inputTokens.toLocaleString()}  ${pct(report.inputTokens, totalTokenBase)}`),
    metric("↓ output", `${report.outputTokens.toLocaleString()}  ${pct(report.outputTokens, totalTokenBase)}`),
    metric("input bar", bar(report.inputTokens, totalTokenBase, chartWidth)),
    metric("output bar", bar(report.outputTokens, totalTokenBase, chartWidth)),
    "",
    "SCAFFOLDS",
    metric("planner", `${report.plannerTokens.toLocaleString()}  ${pct(report.plannerTokens, totalTokenBase)}`),
    metric("executor", `${report.executorTokens.toLocaleString()}  ${pct(report.executorTokens, totalTokenBase)}`),
    metric("planner bar", bar(report.plannerTokens, totalTokenBase, chartWidth)),
    metric("exec bar", bar(report.executorTokens, totalTokenBase, chartWidth)),
  ];

  if (showContext) {
    lines.push(metric("live ctx", contextTokens.toLocaleString()));
    lines.push(metric("% limit", contextLimit > 0 ? pct(contextTokens, contextLimit) : "n/a"));
    lines.push(metric("ctx bar", bar(contextTokens, Math.max(contextLimit, 1), chartWidth)));
  }

  lines.push(
    "",
    "BLEED",
    metric("tool waste", `${report.toolExposureWaste}  ${pct(report.toolExposureWaste, Math.max(report.toolsExposed, 1))}`),
    metric("idle cliffs", `${report.idleCacheCliffs}  ${pct(report.idleCacheCliffs, totalTurns)}`),
    metric("plan misses", `${report.plannerCacheMisses}  ${pct(report.plannerCacheMisses, Math.max(report.plannerCacheHits + report.plannerCacheMisses, 1))}`),
    metric("compactions", `${report.autoCompactions}  ${pct(report.autoCompactions, totalTurns)}`),
    metric("tool bar", bar(report.toolExposureWaste, Math.max(report.toolsExposed, 1), chartWidth)),
    metric("plan bar", bar(report.plannerCacheMisses, Math.max(report.plannerCacheHits + report.plannerCacheMisses, 1), chartWidth)),
    "",
    "EFFICIENCY",
    metric("turns", String(report.totalTurns)),
    metric("avg / turn", report.avgTokensPerTurn.toLocaleString()),
    metric("tools exposed", `${report.toolsExposed} (${(report.toolsExposed / totalTurns).toFixed(1)}/turn)`),
    metric("tools used", `${report.toolsUsed} (${(report.toolsUsed / totalTurns).toFixed(1)}/turn)`),
    metric("shell saves", String(report.shellRecoveries)),
    metric("carry forwards", String(report.freshThreadCarryForwards)),
  "",
  "ROUTING",
    metric("small turns", `${report.smallModelTurns}  ${pct(report.smallModelTurns, totalTurns)}`),
    metric("reuse", pct(report.plannerCacheHits, Math.max(report.plannerCacheHits + report.plannerCacheMisses, 1))),
    metric("plan hits", String(report.plannerCacheHits)),
    metric("plan misses", String(report.plannerCacheMisses)),
    metric("top bleed", `${report.topBleed.key}  ${report.topBleed.value}  ${report.topBleed.pct}`),
    metric("small bar", bar(report.smallModelTurns, totalTurns, chartWidth)),
  );

  if ((report.topToolBleeds ?? []).length > 0) {
    lines.push("", "HOT TOOLS");
    for (const entry of report.topToolBleeds ?? []) {
      lines.push(metric(entry.tool, `${entry.tokens.toLocaleString()} tok  ${entry.calls} calls`));
    }
  }

  return lines;
}

export function summarizeBudgetMetrics(metrics: SessionBudgetMetrics): string {
  const totalTurns = Math.max(metrics.totalTurns, 1);
  const plannerTokens = metrics.plannerInputTokens + metrics.plannerOutputTokens;
  const executorTokens = metrics.executorInputTokens + metrics.executorOutputTokens;
  const hottestTool = Object.entries(metrics.toolOutputTokens ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const hotToolPart = hottestTool ? ` · hot ${hottestTool[0]} ${hottestTool[1]}` : "";
  return `small ${pct(metrics.smallModelTurns, totalTurns)} · cliffs ${metrics.idleCacheCliffs} · tool waste ${Math.max(0, metrics.toolsExposed - metrics.toolsUsed)} · shell saves ${metrics.shellRecoveries} · planner ${plannerTokens} · executor ${executorTokens} · plan hits ${metrics.plannerCacheHits}${hotToolPart}`;
}
