import type { ModelCapability, ModelInfo, Provider } from "../providers/types.js";

/** Context available when making a routing decision */
export interface RoutingContext {
  /** Estimated input tokens for this request */
  estimatedInputTokens: number;
  /** Capabilities required for this request */
  requiredCapabilities: ModelCapability[];
  /** Remaining budget in USD (undefined = no limit) */
  budgetRemaining?: number;
  /** User's preferred provider (from config or /model) */
  preferredProvider?: string;
  /** User's preferred model (from config or /model) */
  preferredModel?: string;
  /** Whether a local provider is available */
  localAvailable: boolean;
}

/** The result of a routing decision */
export interface RoutingDecision {
  provider: Provider;
  model: ModelInfo;
  estimatedCost: number;
  reason: string;
}

/** Strategy interface — each routing mode implements this */
export interface RoutingStrategy {
  name: string;
  select(
    ctx: RoutingContext,
    providers: Provider[],
  ): RoutingDecision | null;
}
