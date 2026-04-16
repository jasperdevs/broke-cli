export type ThinkingFormat = "openai" | "qwen";

export interface ProviderCompatSettings {
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsTools?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  thinkingFormat?: ThinkingFormat;
}
