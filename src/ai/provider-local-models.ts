import { getConfiguredProviderBaseUrl } from "../core/models-config.js";
import {
  getCatalogModelIds,
  getProviderPreferredDisplayModelIds,
} from "./model-catalog.js";
import { PROVIDERS } from "./provider-definitions.js";
import { filterModelIdsForDisplay } from "./provider-visibility.js";
import { clearLocalModelMetadata, setLocalProviderModelMetadata, type LocalModelMetadata } from "./local-model-metadata.js";

async function fetchUrl(url: string, timeoutMs = 2000): Promise<unknown> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeInputModalities(value: unknown): Array<"text" | "image"> | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.toLowerCase())
    .filter((entry): entry is "text" | "image" => entry === "text" || entry === "image");
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

interface LocalDiscoveredModel {
  id: string;
  meta?: LocalModelMetadata;
}

async function fetchLocalModels(id: string, baseURL: string): Promise<LocalDiscoveredModel[]> {
  const models = new Map<string, LocalModelMetadata>();
  const openaiData = await fetchUrl(`${baseURL}/models`) as { data?: Array<Record<string, unknown>> } | null;
  if (openaiData?.data) {
    for (const model of openaiData.data) {
      if (typeof model.id !== "string" || !model.id) continue;
      models.set(model.id, {
        name: typeof model.name === "string" ? model.name : undefined,
        contextWindow: asPositiveNumber(model.context_length ?? model.max_context_length ?? model.max_model_len),
        maxTokens: asPositiveNumber(model.max_tokens),
        input: normalizeInputModalities(model.input_modalities ?? model.modalities),
        toolCall: typeof model.tool_call === "boolean" ? model.tool_call : undefined,
        reasoning: typeof model.reasoning === "boolean" ? model.reasoning : undefined,
        source: typeof model.owned_by === "string" ? model.owned_by : undefined,
      });
    }
  }

  if (id === "ollama") {
    const host = baseURL.replace("/v1", "");
    const tagsData = await fetchUrl(`${host}/api/tags`) as { models?: Array<Record<string, unknown>> } | null;
    if (tagsData?.models) {
      for (const model of tagsData.models) {
        if (typeof model.name === "string" && model.name && !models.has(model.name)) {
          models.set(model.name, {});
        }
      }
    }
    for (const [modelId, meta] of [...models.entries()]) {
      const showDetails = await fetch(`${host}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      }).then(async (res) => res.ok ? await res.json() : null).catch(() => null) as Record<string, unknown> | null;
      const info = typeof showDetails?.model_info === "object" && showDetails.model_info !== null
        ? showDetails.model_info as Record<string, unknown>
        : {};
      const details = typeof showDetails?.details === "object" && showDetails.details !== null
        ? showDetails.details as Record<string, unknown>
        : {};
      const capabilities = Array.isArray(showDetails?.capabilities)
        ? showDetails.capabilities.filter((entry): entry is string => typeof entry === "string")
        : [];
      const architecture = typeof info["general.architecture"] === "string" ? info["general.architecture"] : "";
      const contextKey = architecture ? `${architecture}.context_length` : "";
      const contextWindow = asPositiveNumber(info[contextKey]);
      models.set(modelId, {
        ...meta,
        contextWindow: contextWindow ?? meta.contextWindow,
        maxTokens: contextWindow ? contextWindow * 10 : meta.maxTokens,
        reasoning: capabilities.includes("thinking") || meta.reasoning,
        toolCall: capabilities.includes("tools") || meta.toolCall,
        architecture: architecture || meta.architecture,
        parameterSize: asNonEmptyString(details.parameter_size) ?? meta.parameterSize,
        quantization: asNonEmptyString(details.quantization_level) ?? meta.quantization,
        source: "ollama",
      });
    }
  }

  if (id === "llamacpp") {
    const host = baseURL.replace(/\/v1\/?$/, "");
    const modelsData = await fetchUrl(`${host}/models`) as { models?: Array<Record<string, unknown>> } | null;
    if (modelsData?.models) {
      for (const model of modelsData.models) {
        const name = typeof model.model === "string" ? model.model : typeof model.name === "string" ? model.name : undefined;
        if (name && !models.has(name)) {
          models.set(name, {
            name,
            contextWindow: asPositiveNumber(model.context_length ?? model.max_context_length),
            maxTokens: asPositiveNumber(model.max_tokens),
            source: "llama.cpp",
          });
        }
      }
    }
    const slotsData = await fetchUrl(`${host}/slots`) as Array<Record<string, unknown>> | null;
    if (Array.isArray(slotsData)) {
      for (const slot of slotsData) {
        if (typeof slot.model === "string" && slot.model && !models.has(slot.model)) {
          models.set(slot.model, {
            contextWindow: asPositiveNumber(slot.n_ctx ?? slot.context_length),
          });
        }
      }
    }
  }

  if (id === "lmstudio") {
    const host = baseURL.replace("/v1", "");
    const lmsData = await fetchUrl(`${host}/lmstudio/models`) as { data?: Array<Record<string, unknown>> } | null;
    if (lmsData?.data) {
      for (const model of lmsData.data) {
        if (typeof model.id === "string" && model.id) {
          models.set(model.id, {
            name: typeof model.displayName === "string" ? model.displayName : typeof model.name === "string" ? model.name : undefined,
            contextWindow: asPositiveNumber(model.maxContextLength ?? model.contextLength),
            maxTokens: asPositiveNumber(model.maxTokens),
            reasoning: typeof model.trainedForToolUse === "boolean" ? model.trainedForToolUse : undefined,
            toolCall: typeof model.trainedForToolUse === "boolean" ? model.trainedForToolUse : undefined,
            input: model.vision === true ? ["text", "image"] : ["text"],
            quantization: asNonEmptyString(model.quantization),
            parameterSize: asNonEmptyString(model.parameterCount),
            architecture: asNonEmptyString(model.architecture),
            source: "lmstudio",
          });
        }
      }
    }
  }

  return [...models.entries()].map(([id, meta]) => ({ id, meta }));
}

export function syncCloudProviderModelsFromCatalog(): void {
  const mappings: Array<{ providerId: string; catalogProviderId?: string }> = [
    { providerId: "anthropic" },
    { providerId: "openai" },
    { providerId: "github-copilot" },
    { providerId: "google" },
    { providerId: "google-gemini-cli" },
    { providerId: "google-antigravity" },
    { providerId: "mistral" },
    { providerId: "groq" },
    { providerId: "xai" },
    { providerId: "openrouter" },
  ];

  for (const { providerId, catalogProviderId } of mappings) {
    const modelIds = getCatalogModelIds(catalogProviderId ?? providerId);
    if (!modelIds || modelIds.length === 0 || !PROVIDERS[providerId]) continue;
    const preferred = [...getProviderPreferredDisplayModelIds(providerId), ...PROVIDERS[providerId].models];
    PROVIDERS[providerId].models = filterModelIdsForDisplay(providerId, modelIds, preferred);
    if (!PROVIDERS[providerId].models.includes(PROVIDERS[providerId].defaultModel)) {
      PROVIDERS[providerId].defaultModel = PROVIDERS[providerId].models[0];
    }
  }
}

export async function refreshLocalModels(detectedIds: string[]): Promise<void> {
  clearLocalModelMetadata();
  const localProviders: Record<string, string> = {
    ollama: "http://127.0.0.1:11434/v1",
    lmstudio: "http://127.0.0.1:1234/v1",
    llamacpp: "http://127.0.0.1:8080/v1",
    jan: "http://127.0.0.1:1337/v1",
    vllm: "http://127.0.0.1:8000/v1",
  };

  const fetches = detectedIds
    .filter((id) => id in localProviders)
    .map(async (id) => {
      const models = await fetchLocalModels(id, getConfiguredProviderBaseUrl(id) ?? localProviders[id]);
      if (models.length > 0 && PROVIDERS[id]) {
        PROVIDERS[id].models = models.map((model) => model.id);
        PROVIDERS[id].defaultModel = models[0]!.id;
        setLocalProviderModelMetadata(id, Object.fromEntries(models.map((model) => [model.id, model.meta ?? {}])));
      }
    });

  await Promise.all(fetches);
}
