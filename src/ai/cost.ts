import { getModelContextLimit, getModelPricing, loadModelCatalog } from "./model-catalog.js";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
}

export async function loadPricing(): Promise<void> {
  await loadModelCatalog();
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  providerId?: string,
  cacheTokens?: { cacheReadTokens?: number; cacheWriteTokens?: number },
): TokenUsage {
  const pricing = getModelPricing(model, providerId);
  const cacheReadTokens = cacheTokens?.cacheReadTokens ?? 0;
  const cacheWriteTokens = cacheTokens?.cacheWriteTokens ?? 0;
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheReadTokens / 1_000_000) * (pricing.cacheRead ?? pricing.input) +
    (cacheWriteTokens / 1_000_000) * (pricing.cacheWrite ?? pricing.input);

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens,
    cost,
  };
}

export function getContextLimit(model: string, providerId?: string): number | null {
  return getModelContextLimit(model, providerId);
}

export function isLocalModel(model: string, providerId?: string): boolean {
  const pricing = getModelPricing(model, providerId);
  return pricing.input === 0 && pricing.output === 0;
}
