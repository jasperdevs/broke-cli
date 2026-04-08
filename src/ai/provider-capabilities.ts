export interface ProviderCapabilities {
  reasoningProvider?: "anthropic" | "openai" | "google";
  cacheHints?: {
    messageEphemeral?: boolean;
    topLevelEphemeral?: boolean;
    promptCacheKey?: boolean;
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

export function getProviderCapabilities(providerId?: string): ProviderCapabilities {
  if (!providerId) return {};
  return PROVIDER_CAPABILITIES[providerId] ?? {};
}
