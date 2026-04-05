import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { DetectedProvider, ModelInfo, ModelPricing, Provider } from "./types.js";

/** Known providers and their env var + default models */
const KNOWN_PROVIDERS: Record<
  string,
  {
    envKey: string;
    name: string;
    factory: (opts: { apiKey: string; baseURL?: string }) => {
      languageModel(modelId: string): LanguageModelV3;
    };
    defaultModels: Array<{ id: string; displayName: string; pricing: ModelPricing; contextWindow: number }>;
  }
> = {
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    name: "Anthropic",
    factory: (opts) => {
      const sdk = createAnthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
      return { languageModel: (id: string) => sdk(id) as unknown as LanguageModelV3 };
    },
    defaultModels: [
      { id: "claude-sonnet-4-5-20250514", displayName: "Claude Sonnet 4.5", pricing: { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 }, contextWindow: 200000 },
      { id: "claude-haiku-3-5-20241022", displayName: "Claude Haiku 3.5", pricing: { inputPerMTok: 0.8, outputPerMTok: 4, cacheReadPerMTok: 0.08, cacheWritePerMTok: 1 }, contextWindow: 200000 },
      { id: "claude-opus-4-20250514", displayName: "Claude Opus 4", pricing: { inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 }, contextWindow: 200000 },
    ],
  },
  openai: {
    envKey: "OPENAI_API_KEY",
    name: "OpenAI",
    factory: (opts) => {
      const sdk = createOpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
      return { languageModel: (id: string) => sdk(id) as unknown as LanguageModelV3 };
    },
    defaultModels: [
      { id: "gpt-4o", displayName: "GPT-4o", pricing: { inputPerMTok: 2.5, outputPerMTok: 10 }, contextWindow: 128000 },
      { id: "gpt-4o-mini", displayName: "GPT-4o Mini", pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 }, contextWindow: 128000 },
      { id: "gpt-4.1", displayName: "GPT-4.1", pricing: { inputPerMTok: 2, outputPerMTok: 8 }, contextWindow: 1000000 },
      { id: "gpt-4.1-nano", displayName: "GPT-4.1 Nano", pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4 }, contextWindow: 1000000 },
    ],
  },
};

/** Create a Provider from a detected config */
function createProvider(
  id: string,
  apiKey: string,
  baseUrl?: string,
): Provider | null {
  const known = KNOWN_PROVIDERS[id];
  if (!known) return null;

  const sdk = known.factory({ apiKey, baseURL: baseUrl });

  const models: ModelInfo[] = known.defaultModels.map((m) => ({
    ...m,
    provider: id,
    capabilities: ["streaming", "tools"],
  }));

  return {
    id,
    name: known.name,
    isLocal: false,
    getModel: (modelId: string) => sdk.languageModel(modelId),
    listModels: () => models,
  };
}

/** Detect available providers from env vars and config */
export function detectProviders(
  configProviders: Record<string, { apiKey?: string; baseUrl?: string; enabled?: boolean }>,
): DetectedProvider[] {
  const detected: DetectedProvider[] = [];

  for (const [id, known] of Object.entries(KNOWN_PROVIDERS)) {
    const configEntry = configProviders[id];
    const apiKey = configEntry?.apiKey ?? process.env[known.envKey];
    const enabled = configEntry?.enabled !== false;

    if (apiKey && enabled) {
      detected.push({
        id,
        name: known.name,
        isLocal: false,
        apiKey,
        baseUrl: configEntry?.baseUrl,
        availableModels: known.defaultModels.map((m) => m.id),
      });
    }
  }

  return detected;
}

/** Build provider instances from detected providers */
export function buildProviders(detected: DetectedProvider[]): Provider[] {
  const providers: Provider[] = [];

  for (const d of detected) {
    if (!d.apiKey) continue;
    const provider = createProvider(d.id, d.apiKey, d.baseUrl);
    if (provider) providers.push(provider);
  }

  return providers;
}

/** Find a specific model across all providers */
export function findModel(
  providers: Provider[],
  modelSpec: string,
): { provider: Provider; model: ModelInfo } | null {
  // Format: "provider/model-id" or just "model-id"
  const [providerHint, modelId] = modelSpec.includes("/")
    ? modelSpec.split("/", 2)
    : [undefined, modelSpec];

  for (const provider of providers) {
    if (providerHint && provider.id !== providerHint) continue;
    const model = provider.listModels().find((m) => m.id === modelId || m.displayName.toLowerCase().includes(modelId.toLowerCase()));
    if (model) return { provider, model };
  }

  return null;
}
