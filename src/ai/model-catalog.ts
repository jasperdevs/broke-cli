import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { writePrivateTextFile } from "../core/private-files.js";
import { listConfiguredProviderIds } from "../core/models-config.js";
import { getConfiguredModelSpec, mergeConfiguredModelOverride } from "./model-spec-overrides.js";
import { getLocalModelMetadata } from "./local-model-metadata.js";
import type { ModelPricing, ModelSpec } from "./model-types.js";
import generatedCatalog from "./model-catalog.generated.json";

export type { ModelLimits, ModelPricing, ModelSpec } from "./model-types.js";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MODEL_CATALOG_CACHE_PATH = join(homedir(), ".brokecli", "model-catalog-cache.json");

const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string().optional(),
  attachment: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  modalities: z.object({
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
  }).optional(),
  cost: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    reasoning: z.number().optional(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
  }).optional(),
  limit: z.object({
    context: z.number().optional(),
    input: z.number().optional(),
    output: z.number().optional(),
  }).default({}),
});

const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  models: z.record(modelSchema),
});

const catalogSchema = z.record(providerSchema);

type Catalog = z.infer<typeof catalogSchema>;

const GENERATED_CATALOG = catalogSchema.parse(generatedCatalog);

const providerAliases: Record<string, string> = { codex: "openai" };

interface ProviderModelProfile {
  defaultModel: string;
  nativeDefaultModel?: string;
  smallModel?: string;
  nativeSmallModel?: string;
  preferredDisplay: string[];
  nativePreferredDisplay?: string[];
  maxVisible?: number;
}

const PROVIDER_MODEL_PROFILES: Record<string, ProviderModelProfile> = {
  anthropic: {
    defaultModel: "claude-sonnet-4-6",
    smallModel: "claude-haiku-4-5-20251001",
    preferredDisplay: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "claude-sonnet-4-5", "claude-opus-4-1"],
    maxVisible: 6,
  },
  openai: {
    defaultModel: "gpt-5.4-mini",
    smallModel: "gpt-4o-mini",
    preferredDisplay: ["gpt-5.2-codex", "gpt-5.4-mini", "gpt-5-mini", "gpt-5.4", "o4-mini", "o3", "gpt-4.1"],
    maxVisible: 8,
  },
  codex: {
    defaultModel: "gpt-5.4",
    nativeDefaultModel: "gpt-5.4",
    smallModel: "gpt-5-codex-mini",
    nativeSmallModel: "gpt-5-codex-mini",
    preferredDisplay: ["gpt-5-mini", "gpt-5.4-mini", "gpt-5.4", "o4-mini", "o3"],
    nativePreferredDisplay: ["gpt-5.4", "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.2", "gpt-5.1", "gpt-5-codex", "gpt-5", "gpt-5.4-mini"],
    maxVisible: 10,
  },
  "github-copilot": {
    defaultModel: "gpt-4o",
    smallModel: "gpt-4o",
    preferredDisplay: ["gpt-4o", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2-codex", "claude-sonnet-4.6", "claude-opus-4.6", "gemini-2.5-pro", "grok-code-fast-1"],
    maxVisible: 10,
  },
  google: {
    defaultModel: "gemini-2.5-flash",
    smallModel: "gemini-2.0-flash",
    preferredDisplay: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
    maxVisible: 8,
  },
  "google-gemini-cli": {
    defaultModel: "gemini-2.5-pro",
    smallModel: "gemini-2.0-flash",
    preferredDisplay: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-3-flash-preview"],
    maxVisible: 8,
  },
  "google-antigravity": {
    defaultModel: "gemini-3.1-pro-high",
    smallModel: "gemini-3-flash",
    preferredDisplay: ["gemini-3.1-pro-high", "gemini-3.1-pro-low", "gemini-3-flash", "claude-sonnet-4-6", "claude-opus-4-6-thinking", "gpt-oss-120b-medium"],
    maxVisible: 8,
  },
  mistral: {
    defaultModel: "mistral-small-latest",
    smallModel: "mistral-small-latest",
    preferredDisplay: ["codestral-latest", "mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
    maxVisible: 8,
  },
  groq: {
    defaultModel: "llama-3.3-70b-versatile",
    smallModel: "llama-3.1-8b-instant",
    preferredDisplay: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen-qwq-32b", "groq/compound-mini"],
    maxVisible: 8,
  },
  xai: {
    defaultModel: "grok-3-mini",
    smallModel: "grok-3-mini",
    preferredDisplay: ["grok-code-fast-1", "grok-4-fast", "grok-3-mini", "grok-4"],
    maxVisible: 8,
  },
  openrouter: {
    defaultModel: "anthropic/claude-sonnet-4",
    preferredDisplay: ["openai/gpt-5.2-codex", "anthropic/claude-sonnet-4", "google/gemini-2.5-flash"],
    maxVisible: 6,
  },
};

let catalogCache: Catalog | null = null;

function normalizeProviderId(providerId?: string): string | undefined {
  if (!providerId) return undefined;
  return providerAliases[providerId] ?? providerId;
}

function asModelSpec(providerId: string, model: z.infer<typeof modelSchema>): ModelSpec {
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    providerId,
    attachment: model.attachment,
    reasoning: model.reasoning,
    toolCall: model.tool_call,
    modalities: {
      input: model.modalities?.input,
      output: model.modalities?.output,
    },
    cost: model.cost ? {
      input: model.cost.input ?? 0,
      output: model.cost.output ?? 0,
      reasoning: model.cost.reasoning,
      cacheRead: model.cost.cache_read,
      cacheWrite: model.cost.cache_write,
    } : undefined,
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
  };
}

function getCatalog(): Catalog { return catalogCache ?? GENERATED_CATALOG; }

function readCachedCatalog(): Catalog | null {
  if (!existsSync(MODEL_CATALOG_CACHE_PATH)) return null;
  try {
    return catalogSchema.parse(JSON.parse(readFileSync(MODEL_CATALOG_CACHE_PATH, "utf-8")));
  } catch {
    return null;
  }
}

function writeCachedCatalog(catalog: Catalog): void {
  try {
    writePrivateTextFile(MODEL_CATALOG_CACHE_PATH, JSON.stringify(catalog));
  } catch {
    // Cache writes are best effort only.
  }
}

export async function loadModelCatalog(): Promise<void> {
  if (catalogCache) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(MODELS_DEV_API_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = catalogSchema.parse(await res.json());
    catalogCache = parsed;
    writeCachedCatalog(parsed);
  } catch {
    catalogCache = readCachedCatalog() ?? GENERATED_CATALOG;
  }
}

export function resetModelCatalogForTests(): void { catalogCache = null; }

export function getModelCatalogCachePathForTests(): string { return MODEL_CATALOG_CACHE_PATH; }

export function getCatalogModelIds(providerId: string): string[] | null {
  const resolvedProviderId = normalizeProviderId(providerId);
  if (!resolvedProviderId) return null;
  const provider = getCatalog()[resolvedProviderId];
  if (!provider) return null;
  return Object.keys(provider.models);
}

export function getProviderDefaultModelId(providerId: string): string | undefined {
  return PROVIDER_MODEL_PROFILES[providerId]?.defaultModel;
}

export function getProviderNativeDefaultModelId(providerId: string): string | undefined {
  return PROVIDER_MODEL_PROFILES[providerId]?.nativeDefaultModel;
}

export function getProviderSmallModelId(providerId: string): string | undefined {
  return PROVIDER_MODEL_PROFILES[providerId]?.smallModel;
}

export function getProviderNativeSmallModelId(providerId: string): string | undefined {
  return PROVIDER_MODEL_PROFILES[providerId]?.nativeSmallModel ?? PROVIDER_MODEL_PROFILES[providerId]?.nativeDefaultModel;
}

export function getProviderPreferredDisplayModelIds(providerId: string): string[] {
  return PROVIDER_MODEL_PROFILES[providerId]?.preferredDisplay ?? [];
}

export function getProviderNativePreferredDisplayModelIds(providerId: string): string[] {
  return PROVIDER_MODEL_PROFILES[providerId]?.nativePreferredDisplay ?? getProviderPreferredDisplayModelIds(providerId);
}

export function getProviderMaxVisibleModelCount(providerId: string): number {
  return PROVIDER_MODEL_PROFILES[providerId]?.maxVisible ?? 10;
}

export function getModelSpec(modelId: string, providerId?: string): ModelSpec | null {
  const catalog = getCatalog();
  const resolvedProviderId = normalizeProviderId(providerId);
  const providerCandidates = resolvedProviderId ? [resolvedProviderId] : [];

  for (const candidate of providerCandidates) {
    const provider = catalog[candidate];
    if (provider?.models[modelId]) return mergeConfiguredModelOverride(asModelSpec(provider.id, provider.models[modelId]), candidate, modelId);
  }

  for (const provider of Object.values(catalog)) {
    if (provider.models[modelId]) return mergeConfiguredModelOverride(asModelSpec(provider.id, provider.models[modelId]), provider.id, modelId);
  }

  for (const provider of Object.values(catalog)) {
    for (const [key, model] of Object.entries(provider.models)) {
      if (key === modelId || key.endsWith(`/${modelId}`) || model.id === modelId) {
        return mergeConfiguredModelOverride(asModelSpec(provider.id, model), provider.id, modelId);
      }
    }
  }

  for (const configuredProviderId of listConfiguredProviderIds()) {
    const configuredModel = getConfiguredModelSpec(configuredProviderId, modelId);
    if (configuredModel) return configuredModel;
  }

  if (providerId) {
    const localMeta = getLocalModelMetadata(providerId, modelId);
    if (localMeta) {
      return {
        id: modelId,
        name: localMeta.name ?? modelId,
        providerId,
        reasoning: localMeta.reasoning,
        toolCall: localMeta.toolCall,
        modalities: {
          input: localMeta.input,
          output: ["text"],
        },
        cost: { input: 0, output: 0 },
        limit: {
          context: localMeta.contextWindow,
          output: localMeta.maxTokens,
        },
      };
    }
  }

  return null;
}

export function getModelPricing(modelId: string, providerId?: string): ModelPricing {
  const spec = getModelSpec(modelId, providerId);
  return spec?.cost ?? { input: 0, output: 0 };
}

export function getModelContextLimit(modelId: string, providerId?: string): number | null {
  const spec = getModelSpec(modelId, providerId);
  return spec?.limit.context ?? null;
}

export function modelSupportsReasoning(modelId: string, providerId?: string): boolean {
  const spec = getModelSpec(modelId, providerId);
  return !!spec?.reasoning;
}

export function getPrettyModelName(modelId: string, providerId?: string): string {
  const spec = getModelSpec(modelId, providerId);
  if (spec?.name?.trim()) return spec.name.trim();
  const base = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
  return base
    .replace(/-GGUF(:[^\s]*)?/gi, "")
    .replace(/[-_]+/g, " ")
    .replace(/\bo(\d)\b/gi, (_m, n) => `o${n}`)
    .replace(/\bgpt (\d(?:\.\d+)?) mini\b/gi, "GPT-$1 mini")
    .replace(/\bgpt (\d(?:\.\d+)?)\b/gi, "GPT-$1")
    .replace(/\bui\b/g, "UI")
    .replace(/\bapi\b/g, "API")
    .replace(/\bux\b/g, "UX")
    .replace(/\b([a-z])([a-z]*)/gi, (_m, a, b) => a.toUpperCase() + b.toLowerCase())
    .trim();
}
