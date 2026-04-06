import { z } from "zod";

const MODELS_DEV_API_URL = "https://models.dev/api.json";

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
}

const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string().optional(),
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
    limit: { context: 200_000, output: 64_000 },
  },
  {
    providerId: "anthropic",
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    cost: { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
    limit: { context: 200_000, output: 64_000 },
  },
  {
    providerId: "anthropic",
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    cost: { input: 1.0, output: 5.0 },
    limit: { context: 200_000, output: 64_000 },
  },
  {
    providerId: "openai",
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    cost: { input: 0.15, output: 0.6 },
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
    cost: { input: 0.4, output: 1.6 },
    limit: { context: 1_047_576, output: 32_768 },
  },
  {
    providerId: "openai",
    id: "gpt-4.1",
    name: "GPT-4.1",
    cost: { input: 2.0, output: 8.0 },
    limit: { context: 1_047_576, output: 32_768 },
  },
  {
    providerId: "openai",
    id: "o3-mini",
    name: "o3-mini",
    cost: { input: 1.1, output: 4.4 },
    limit: { context: 200_000, output: 100_000 },
  },
  {
    providerId: "google",
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    cost: { input: 0.3, output: 2.5, cacheRead: 0.075 },
    limit: { context: 1_048_576, output: 65_536 },
  },
  {
    providerId: "google",
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    cost: { input: 1.25, output: 10.0, cacheRead: 0.31 },
    limit: { context: 1_048_576, output: 65_536 },
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
  } catch {
    catalogCache = buildFallbackCatalog();
  }
}

export function getCatalogModelIds(providerId: string): string[] | null {
  const resolvedProviderId = normalizeProviderId(providerId);
  if (!resolvedProviderId) return null;
  const provider = getCatalog()[resolvedProviderId];
  if (!provider) return null;
  return Object.keys(provider.models);
}

export function getModelSpec(modelId: string, providerId?: string): ModelSpec | null {
  const catalog = getCatalog();
  const resolvedProviderId = normalizeProviderId(providerId);
  const providerCandidates = resolvedProviderId ? [resolvedProviderId] : [];

  for (const candidate of providerCandidates) {
    const provider = catalog[candidate];
    if (provider?.models[modelId]) return asModelSpec(provider.id, provider.models[modelId]);
  }

  for (const provider of Object.values(catalog)) {
    if (provider.models[modelId]) return asModelSpec(provider.id, provider.models[modelId]);
  }

  for (const provider of Object.values(catalog)) {
    for (const [key, model] of Object.entries(provider.models)) {
      if (key === modelId || key.endsWith(`/${modelId}`) || model.id === modelId) {
        return asModelSpec(provider.id, model);
      }
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
