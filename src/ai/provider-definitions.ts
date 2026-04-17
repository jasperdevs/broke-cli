import type { LanguageModel } from "ai";
import {
  getProviderDefaultModelId,
  getProviderPreferredDisplayModelIds,
} from "./model-catalog.js";
import type { ProviderApiType } from "../core/models-config.js";
import type { ProviderCompatSettings } from "./provider-compat-types.js";

export interface ProviderInfo {
  id: string;
  name: string;
  defaultModel: string;
  models: string[];
  apiType?: ProviderApiType;
  compat?: ProviderCompatSettings;
  baseUrl?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  custom?: boolean;
}

export type ModelRuntime = "sdk" | "native-cli" | "oauth-stream";

export interface ModelHandle {
  provider: ProviderInfo;
  modelId: string;
  runtime: ModelRuntime;
  model?: LanguageModel;
  nativeCommand?: "claude" | "codex";
}

export const SUPPORTED_PROVIDER_IDS = ["openai", "anthropic", "google", "mistral", "xai"] as const;
export type SupportedProviderId = typeof SUPPORTED_PROVIDER_IDS[number];
export const SUPPORTED_PROVIDER_ID_SET = new Set<string>(SUPPORTED_PROVIDER_IDS);

export const PROVIDER_POPULARITY: Record<string, number> = {
  openai: 1,
  anthropic: 2,
  google: 3,
  mistral: 4,
  xai: 5,
};

export const LOCAL_PROVIDER_IDS = new Set<string>();

export const BUILTIN_PROVIDERS: Record<string, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    defaultModel: getProviderDefaultModelId("anthropic") ?? "claude-sonnet-4-6",
    models: [
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-6",
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultModel: getProviderDefaultModelId("openai") ?? "gpt-5.4-mini",
    models: [...getProviderPreferredDisplayModelIds("openai")],
  },
  google: {
    id: "google",
    name: "Google",
    defaultModel: getProviderDefaultModelId("google") ?? "gemini-2.5-flash",
    models: [...getProviderPreferredDisplayModelIds("google")],
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    defaultModel: "mistral-small-latest",
    models: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest", "codestral-latest"],
  },
  xai: {
    id: "xai",
    name: "xAI",
    defaultModel: "grok-3-mini",
    models: ["grok-3-mini", "grok-3"],
  },
};

export let PROVIDERS: Record<string, ProviderInfo> = cloneProviders(BUILTIN_PROVIDERS);

function cloneProviders(source: Record<string, ProviderInfo>): Record<string, ProviderInfo> {
  return Object.fromEntries(
    Object.entries(source).map(([providerId, info]) => [providerId, { ...info, models: [...info.models], headers: info.headers ? { ...info.headers } : undefined }]),
  );
}

export function resetRuntimeProviders(): void {
  PROVIDERS = cloneProviders(BUILTIN_PROVIDERS);
}

export function setRuntimeProviderInfo(provider: ProviderInfo): void {
  PROVIDERS[provider.id] = {
    ...provider,
    models: [...provider.models],
    headers: provider.headers ? { ...provider.headers } : undefined,
  };
}

export function getProviderInfo(id: string): ProviderInfo | undefined {
  return PROVIDERS[id];
}

export function getProviderPopularity(providerId: string): number {
  return PROVIDER_POPULARITY[providerId] ?? 999;
}

export function supportsProviderModel(providerId: string, modelId: string): boolean {
  const provider = PROVIDERS[providerId];
  if (!provider) return false;
  return provider.models.includes(modelId);
}

export function resolveVisibleProviderModelId(providerId: string, modelId?: string): string | undefined {
  const provider = PROVIDERS[providerId];
  if (!provider) return modelId;
  if (!modelId || provider.models.includes(modelId)) return modelId;
  return provider.defaultModel;
}

export function listProviders(): ProviderInfo[] {
  return Object.values(PROVIDERS);
}
