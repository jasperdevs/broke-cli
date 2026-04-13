import { getConfiguredProviderBaseUrl } from "../core/models-config.js";
import {
  getCatalogModelIds,
  getProviderPreferredDisplayModelIds,
} from "./model-catalog.js";
import { PROVIDERS } from "./provider-definitions.js";
import { filterModelIdsForDisplay } from "./provider-visibility.js";

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

async function fetchLocalModels(id: string, baseURL: string): Promise<string[]> {
  const models: string[] = [];
  const openaiData = await fetchUrl(`${baseURL}/models`) as { data?: Array<{ id: string }> } | null;
  if (openaiData?.data) {
    for (const model of openaiData.data) {
      if (model.id && !models.includes(model.id)) models.push(model.id);
    }
  }

  if (id === "ollama") {
    const host = baseURL.replace("/v1", "");
    const tagsData = await fetchUrl(`${host}/api/tags`) as { models?: Array<{ name: string }> } | null;
    if (tagsData?.models) {
      for (const model of tagsData.models) {
        if (model.name && !models.includes(model.name)) models.push(model.name);
      }
    }
  }

  if (id === "llamacpp") {
    const host = baseURL.replace("/v1", "");
    const modelsData = await fetchUrl(`${host}/models`) as { models?: Array<{ name: string; model: string }> } | null;
    if (modelsData?.models) {
      for (const model of modelsData.models) {
        const name = model.model || model.name;
        if (name && !models.includes(name)) models.push(name);
      }
    }
    const slotsData = await fetchUrl(`${host}/slots`) as Array<{ model: string }> | null;
    if (Array.isArray(slotsData)) {
      for (const slot of slotsData) {
        if (slot.model && !models.includes(slot.model)) models.push(slot.model);
      }
    }
  }

  if (id === "lmstudio") {
    const host = baseURL.replace("/v1", "");
    const lmsData = await fetchUrl(`${host}/lmstudio/models`) as { data?: Array<{ id: string }> } | null;
    if (lmsData?.data) {
      for (const model of lmsData.data) {
        if (model.id && !models.includes(model.id)) models.push(model.id);
      }
    }
  }

  return models;
}

export function syncCloudProviderModelsFromCatalog(): void {
  const mappings: Array<{ providerId: string; catalogProviderId?: string }> = [
    { providerId: "anthropic" },
    { providerId: "openai" },
    { providerId: "google" },
    { providerId: "mistral" },
    { providerId: "groq" },
    { providerId: "xai" },
    { providerId: "openrouter" },
  ];

  for (const { providerId, catalogProviderId } of mappings) {
    const modelIds = getCatalogModelIds(catalogProviderId ?? providerId);
    if (!modelIds || modelIds.length === 0) continue;
    const preferred = [...getProviderPreferredDisplayModelIds(providerId), ...PROVIDERS[providerId].models];
    PROVIDERS[providerId].models = filterModelIdsForDisplay(providerId, modelIds, preferred);
    if (!PROVIDERS[providerId].models.includes(PROVIDERS[providerId].defaultModel)) {
      PROVIDERS[providerId].defaultModel = PROVIDERS[providerId].models[0];
    }
  }
}

export async function refreshLocalModels(detectedIds: string[]): Promise<void> {
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
        PROVIDERS[id].models = models;
        PROVIDERS[id].defaultModel = models[0];
      }
    });

  await Promise.all(fetches);
}
