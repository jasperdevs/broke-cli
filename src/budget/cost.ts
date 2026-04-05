import type { ModelPricing, TokenUsage } from "../providers/types.js";

/** Calculate cost from token usage and model pricing */
export function calculateCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0,
): number {
  const uncachedInput = inputTokens - cachedTokens;
  const inputCost = (uncachedInput / 1_000_000) * pricing.inputPerMTok;
  const cacheCost = pricing.cacheReadPerMTok
    ? (cachedTokens / 1_000_000) * pricing.cacheReadPerMTok
    : (cachedTokens / 1_000_000) * pricing.inputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMTok;

  return inputCost + cacheCost + outputCost;
}

/** Build a TokenUsage object from raw counts + pricing */
export function buildUsage(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0,
): TokenUsage {
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens: inputTokens + outputTokens,
    cost: calculateCost(pricing, inputTokens, outputTokens, cachedTokens),
  };
}

/** Format cost as a readable string */
export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/** Format token count with K/M suffix */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
