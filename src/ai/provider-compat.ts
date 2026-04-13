import { getConfiguredProviderDefinition, getConfiguredProviderModel, getConfiguredProviderModelOverride } from "../core/models-config.js";

export type ThinkingFormat = "openai" | "qwen";

export interface ProviderCompatSettings {
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsTools?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  thinkingFormat?: ThinkingFormat;
}

const BUILTIN_COMPAT: Record<string, ProviderCompatSettings> = {
  anthropic: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    supportsTools: true,
  },
  openai: {
    supportsDeveloperRole: true,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    supportsTools: true,
    maxTokensField: "max_completion_tokens",
    thinkingFormat: "openai",
  },
  codex: {
    supportsDeveloperRole: true,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    supportsTools: true,
    maxTokensField: "max_completion_tokens",
    thinkingFormat: "openai",
  },
  google: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    supportsTools: true,
  },
  ollama: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    maxTokensField: "max_tokens",
  },
  lmstudio: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    maxTokensField: "max_tokens",
  },
  llamacpp: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    maxTokensField: "max_tokens",
  },
  jan: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    maxTokensField: "max_tokens",
  },
  vllm: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    maxTokensField: "max_tokens",
  },
};

function mergeCompat(
  base: ProviderCompatSettings | undefined,
  override: ProviderCompatSettings | undefined,
): ProviderCompatSettings {
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

export function getProviderCompat(providerId?: string, modelId?: string): ProviderCompatSettings {
  if (!providerId) return {};
  const configuredProvider = getConfiguredProviderDefinition(providerId);
  const configuredModel = modelId ? getConfiguredProviderModel(providerId, modelId) : undefined;
  const configuredOverride = modelId ? getConfiguredProviderModelOverride(providerId, modelId) : undefined;
  return mergeCompat(
    mergeCompat(
      BUILTIN_COMPAT[providerId],
      configuredProvider?.compat,
    ),
    configuredOverride?.compat ?? configuredModel?.compat,
  );
}
