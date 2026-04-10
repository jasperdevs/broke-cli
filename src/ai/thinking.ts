import { getSettings } from "../core/config.js";
import type { ThinkingLevel } from "../core/config.js";
import type { ModelRuntime } from "./providers.js";
import { getModelCapabilities } from "./provider-capabilities.js";

const THINKING_LEVELS_ALL: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const THINKING_LEVELS_EFFORT_ONLY: ThinkingLevel[] = ["off", "low", "medium", "high"];

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
  const capabilities = getModelCapabilities({ providerId, modelId });
  if (!enabled || !capabilities.reasoning.supported) {
    return { enabled: false };
  }
  return {
    enabled: true,
    effort: normalizeEffort(level),
    budgetTokens: resolveBudget(level),
  };
}

export function getRequestedThinkingLevel(level?: string, enabled?: boolean): ThinkingLevel {
  if (!enabled) return "off";
  const raw = (level ?? "low").toLowerCase();
  return THINKING_LEVELS_ALL.includes(raw as ThinkingLevel) ? raw as ThinkingLevel : "low";
}

export function getAvailableThinkingLevels(options: {
  providerId?: string;
  modelId?: string;
  runtime?: ModelRuntime;
}): ThinkingLevel[] {
  const { providerId, modelId, runtime } = options;
  const capabilities = getModelCapabilities({ providerId, modelId, runtime });
  return capabilities.reasoning.levels as ThinkingLevel[];
}

export function clampThinkingLevel(level: ThinkingLevel, availableLevels: ThinkingLevel[]): ThinkingLevel {
  if (availableLevels.includes(level)) return level;
  const requestedIndex = THINKING_LEVELS_ALL.indexOf(level);
  if (requestedIndex === -1) return availableLevels[0] ?? "off";
  for (let distance = 1; distance < THINKING_LEVELS_ALL.length; distance += 1) {
    const higher = THINKING_LEVELS_ALL[requestedIndex + distance];
    if (higher && availableLevels.includes(higher)) return higher;
    const lower = THINKING_LEVELS_ALL[requestedIndex - distance];
    if (lower && availableLevels.includes(lower)) return lower;
  }
  return availableLevels[0] ?? "off";
}

export function getEffectiveThinkingLevel(options: {
  providerId?: string;
  modelId?: string;
  runtime?: ModelRuntime;
  level?: string;
  enabled?: boolean;
}): ThinkingLevel {
  const requested = getRequestedThinkingLevel(options.level, options.enabled);
  const available = getAvailableThinkingLevels(options);
  return clampThinkingLevel(requested, available);
}
