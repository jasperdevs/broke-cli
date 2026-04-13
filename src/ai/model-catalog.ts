import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { writePrivateTextFile } from "../core/private-files.js";
import { listConfiguredProviderIds } from "../core/models-config.js";
import { getConfiguredModelSpec, mergeConfiguredModelOverride } from "./model-spec-overrides.js";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MODEL_CATALOG_CACHE_PATH = join(homedir(), ".brokecli", "model-catalog-cache.json");

export interface ModelPricing {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelLimits {
  context?: number;
  input?: number;
  output?: number;
}

export interface ModelSpec {
  id: string;
  name: string;
  family?: string;
  cost?: ModelPricing;
  limit: ModelLimits;
  providerId: string;
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
}

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

const FALLBACK_SPECS: ModelSpec[] = [
  {
    providerId: "anthropic",
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
    limit: { context: 1_000_000, output: 64_000 },
    reasoning: true,
  },
  {
    providerId: "anthropic",
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    cost: { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
    limit: { context: 1_000_000, output: 128_000 },
    reasoning: true,
  },
  {
    providerId: "anthropic",
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    cost: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
    limit: { context: 200_000, output: 64_000 },
  },
  {
    providerId: "openai",
    id: "gpt-5-mini",
    name: "GPT-5 mini",
    cost: { input: 0.25, output: 2.0, reasoning: 0.25, cacheRead: 0.025 },
    limit: { context: 400_000, output: 128_000 },
    reasoning: true,
  },
  {
    providerId: "openai",
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    cost: { input: 0.75, output: 4.5, reasoning: 0.75, cacheRead: 0.075 },
    limit: { context: 400_000, output: 128_000 },
    reasoning: true,
  },
  {
    providerId: "openai",
    id: "gpt-5.4",
    name: "GPT-5.4",
    cost: { input: 2.5, output: 15.0, reasoning: 2.5, cacheRead: 0.25 },
    limit: { context: 1_050_000, output: 128_000 },
    reasoning: true,
  },
  {
    providerId: "openai",
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    cost: { input: 0.15, output: 0.6, cacheRead: 0.08 },
    limit: { context: 128_000, output: 16_384 },
  },
  {
    providerId: "openai",
    id: "gpt-4o",
    name: "GPT-4o",
    cost: { input: 2.5, output: 10.0 },
    limit: { context: 128_000, output: 16_384 },
  },
  {
    providerId: "openai",
    id: "gpt-4.1-mini",
    name: "GPT-4.1 mini",
    cost: { input: 0.4, output: 1.6, cacheRead: 0.1 },
    limit: { context: 1_047_576, output: 32_768 },
  },
  {
    providerId: "openai",
    id: "gpt-4.1",
    name: "GPT-4.1",
    cost: { input: 2.0, output: 8.0, cacheRead: 0.5 },
    limit: { context: 1_047_576, output: 32_768 },
  },
  {
    providerId: "openai",
    id: "o3-mini",
    name: "o3-mini",
    cost: { input: 1.1, output: 4.4, cacheRead: 0.55 },
    limit: { context: 200_000, output: 100_000 },
    reasoning: true,
  },
  {
    providerId: "openai",
    id: "o3",
    name: "o3",
    cost: { input: 2.0, output: 8.0, cacheRead: 0.5 },
    limit: { context: 200_000, output: 100_000 },
    reasoning: true,
  },
  {
    providerId: "openai",
    id: "o4-mini",
    name: "o4-mini",
    cost: { input: 1.1, output: 4.4, cacheRead: 0.28 },
    limit: { context: 200_000, output: 100_000 },
    reasoning: true,
  },
  {
    providerId: "google",
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    cost: { input: 0.3, output: 2.5, cacheRead: 0.075 },
    limit: { context: 1_048_576, output: 65_536 },
    reasoning: true,
  },
  {
    providerId: "google",
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    cost: { input: 1.25, output: 10.0, cacheRead: 0.31 },
    limit: { context: 1_048_576, output: 65_536 },
    reasoning: true,
  },
  {
    providerId: "google",
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    cost: { input: 0.1, output: 0.4, cacheRead: 0.025 },
    limit: { context: 1_048_576, output: 8_192 },
  },
];

const providerAliases: Record<string, string> = {
  codex: "openai",
};

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
    preferredDisplay: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6"],
    maxVisible: 6,
  },
  openai: {
    defaultModel: "gpt-5.4-mini",
    smallModel: "gpt-4o-mini",
    preferredDisplay: ["gpt-5.2-codex", "gpt-5.4-mini", "gpt-5-mini", "gpt-5.4", "o4-mini", "o3", "gpt-4.1"],
    maxVisible: 8,
  },
  codex: {
    defaultModel: "gpt-5-mini",
    nativeDefaultModel: "gpt-5.4-mini",
    smallModel: "gpt-5-mini",
    nativeSmallModel: "gpt-5.4-mini",
    preferredDisplay: ["gpt-5-mini", "gpt-5.4-mini", "gpt-5.4", "o4-mini", "o3"],
    nativePreferredDisplay: ["gpt-5.4-mini"],
    maxVisible: 8,
  },
  google: {
    defaultModel: "gemini-2.5-flash",
    smallModel: "gemini-2.0-flash",
    preferredDisplay: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
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
let fallbackCatalog: Catalog | null = null;

function buildFallbackCatalog(): Catalog {
  if (fallbackCatalog) return fallbackCatalog;
  const catalog: Catalog = {};
  for (const spec of FALLBACK_SPECS) {
    if (!catalog[spec.providerId]) {
      catalog[spec.providerId] = {
        id: spec.providerId,
        name: spec.providerId,
        models: {},
      };
    }
    catalog[spec.providerId].models[spec.id] = {
      id: spec.id,
      name: spec.name,
      family: spec.family,
      reasoning: spec.reasoning,
      cost: spec.cost ? {
        input: spec.cost.input,
        output: spec.cost.output,
        reasoning: spec.cost.reasoning,
        cache_read: spec.cost.cacheRead,
        cache_write: spec.cost.cacheWrite,
      } : undefined,
      limit: spec.limit,
    };
  }
  fallbackCatalog = catalog;
  return catalog;
}

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

function getCatalog(): Catalog {
  return catalogCache ?? buildFallbackCatalog();
}

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
    catalogCache = readCachedCatalog() ?? buildFallbackCatalog();
  }
}

export function resetModelCatalogForTests(): void {
  catalogCache = null;
}

export function getModelCatalogCachePathForTests(): string {
  return MODEL_CATALOG_CACHE_PATH;
}

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
