import { getSettings } from "../core/config.js";
import { modelSupportsReasoning } from "./model-catalog.js";

function normalizeEffort(level?: string): "low" | "medium" | "high" {
  const normalized = (level ?? "low").toLowerCase();
  if (normalized === "high" || normalized === "xhigh") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function resolveBudget(level?: string): number {
  const raw = (level ?? "low").toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  const budgets = getSettings().thinkingBudgets;
  return budgets[raw as keyof typeof budgets]
    ?? (raw === "minimal" ? 1024 : raw === "low" ? 4096 : raw === "medium" ? 10240 : raw === "high" ? 32768 : 65536);
}

export function resolveThinkingConfig(options: {
  providerId?: string;
  modelId: string;
  enabled?: boolean;
  level?: string;
}): {
  enabled: boolean;
  effort?: "low" | "medium" | "high";
  budgetTokens?: number;
} {
  const { providerId, modelId, enabled, level } = options;
  if (!enabled || !modelSupportsReasoning(modelId, providerId)) {
    return { enabled: false };
  }
  return {
    enabled: true,
    effort: normalizeEffort(level),
    budgetTokens: resolveBudget(level),
  };
}
