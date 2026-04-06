import { getModelContextLimit, getModelPricing, loadModelCatalog } from "./model-catalog.js";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
): TokenUsage {
  const pricing = getModelPricing(model, providerId);
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return {
    inputTokens,
    outputTokens,
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
