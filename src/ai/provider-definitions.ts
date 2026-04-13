import type { LanguageModel } from "ai";
import {
  getProviderDefaultModelId,
  getProviderPreferredDisplayModelIds,
} from "./model-catalog.js";
import type { ProviderApiType } from "../core/models-config.js";
import type { ProviderCompatSettings } from "./provider-compat.js";

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

export type ModelRuntime = "sdk" | "native-cli";

export interface ModelHandle {
  provider: ProviderInfo;
  modelId: string;
  runtime: ModelRuntime;
  model?: LanguageModel;
  nativeCommand?: "claude" | "codex";
}

export const PROVIDER_POPULARITY: Record<string, number> = {
  codex: 1,
  anthropic: 2,
  openai: 3,
  google: 4,
  groq: 5,
  mistral: 6,
  xai: 7,
  openrouter: 8,
  ollama: 9,
  lmstudio: 10,
  llamacpp: 11,
  jan: 12,
  vllm: 13,
};

export const LOCAL_PROVIDER_IDS = new Set(["ollama", "lmstudio", "llamacpp", "jan", "vllm"]);

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
  codex: {
    id: "codex",
    name: "Codex",
    defaultModel: getProviderDefaultModelId("codex") ?? "gpt-5-mini",
    models: [...getProviderPreferredDisplayModelIds("codex")],
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    defaultModel: "qwen2.5-coder:7b",
    models: ["qwen2.5-coder:7b", "llama3.1:8b", "codellama:13b", "deepseek-coder-v2:16b"],
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    defaultModel: "default",
    models: ["default"],
  },
  llamacpp: {
    id: "llamacpp",
    name: "llama.cpp",
    defaultModel: "default",
    models: ["default"],
  },
  jan: {
    id: "jan",
    name: "Jan",
    defaultModel: "default",
    models: ["default"],
  },
  vllm: {
    id: "vllm",
    name: "vLLM",
    defaultModel: "default",
    models: ["default"],
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
  groq: {
    id: "groq",
    name: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  },
  xai: {
    id: "xai",
    name: "xAI",
    defaultModel: "grok-3-mini",
    models: ["grok-3-mini", "grok-3"],
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    defaultModel: getProviderDefaultModelId("openrouter") ?? "anthropic/claude-sonnet-4",
    models: [...getProviderPreferredDisplayModelIds("openrouter")],
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
