import { modelSupportsReasoning } from "./model-catalog.js";
import type { ModelRuntime } from "./provider-definitions.js";
import { getProviderCompat } from "./provider-compat.js";

export interface ProviderCapabilities {
  reasoningProvider?: "anthropic" | "openai" | "google";
  cacheHints?: {
    messageEphemeral?: boolean;
    topLevelEphemeral?: boolean;
    promptCacheKey?: boolean;
  };
}

export interface ModelCapabilitySnapshot {
  providerId?: string;
  runtime?: ModelRuntime;
  reasoning: {
    supported: boolean;
    provider?: "anthropic" | "openai" | "google";
    levels: Array<"off" | "minimal" | "low" | "medium" | "high" | "xhigh">;
  };
  caching: {
    messageEphemeral: boolean;
    topLevelEphemeral: boolean;
    promptCacheKey: boolean;
  };
}

const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  anthropic: {
    reasoningProvider: "anthropic",
    cacheHints: {
      messageEphemeral: true,
      topLevelEphemeral: true,
    },
  },
  openai: {
    reasoningProvider: "openai",
    cacheHints: {
      promptCacheKey: true,
    },
  },
  codex: {
    reasoningProvider: "openai",
    cacheHints: {
      promptCacheKey: true,
    },
  },
  google: {
    reasoningProvider: "google",
  },
};

const ALL_REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const EFFORT_ONLY_LEVELS = ["off", "low", "medium", "high"] as const;

export function getProviderCapabilities(providerId?: string): ProviderCapabilities {
  if (!providerId) return {};
  return PROVIDER_CAPABILITIES[providerId] ?? {};
}

export function getModelCapabilities(options: {
  providerId?: string;
  modelId?: string;
  runtime?: ModelRuntime;
}): ModelCapabilitySnapshot {
  const { providerId, modelId, runtime } = options;
  const provider = getProviderCapabilities(providerId);
  const compat = getProviderCompat(providerId, modelId);
  const reasoningSupported = !!modelId && !!providerId && modelSupportsReasoning(modelId, providerId);
  const reasoningLevels: ModelCapabilitySnapshot["reasoning"]["levels"] = !reasoningSupported
    ? ["off"]
    : runtime === "native-cli" || (provider.reasoningProvider === "openai" && compat.supportsReasoningEffort !== false)
      ? [...EFFORT_ONLY_LEVELS]
      : [...ALL_REASONING_LEVELS];
  return {
    providerId,
    runtime,
    reasoning: {
      supported: reasoningSupported,
      provider: provider.reasoningProvider,
      levels: reasoningLevels,
    },
    caching: {
      messageEphemeral: provider.cacheHints?.messageEphemeral === true,
      topLevelEphemeral: provider.cacheHints?.topLevelEphemeral === true,
      promptCacheKey: provider.cacheHints?.promptCacheKey === true,
    },
  };
}
