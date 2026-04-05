import type { LanguageModelV3 } from "@ai-sdk/provider";

/** Capabilities a model may support */
export type ModelCapability =
  | "tools"
  | "vision"
  | "streaming"
  | "json-mode"
  | "reasoning";

/** Pricing per million tokens in USD */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

/** Metadata about a specific model */
export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  pricing: ModelPricing;
  contextWindow: number;
  maxOutputTokens?: number;
  capabilities: ModelCapability[];
}

/** Token usage returned after a completion */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  totalTokens: number;
  cost: number;
}

/** A registered provider that can create language models */
export interface Provider {
  id: string;
  name: string;
  isLocal: boolean;
  getModel(modelId: string): LanguageModelV3;
  listModels(): ModelInfo[];
}

/** Provider detection result from env/config */
export interface DetectedProvider {
  id: string;
  name: string;
  isLocal: boolean;
  apiKey?: string;
  baseUrl?: string;
  availableModels: string[];
}
