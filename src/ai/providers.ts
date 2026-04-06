import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import { getApiKey, getBaseUrl, getProviderCredential } from "../core/config.js";
import {
  getCatalogModelIds,
  getModelSpec,
  getProviderDefaultModelId,
  getProviderMaxVisibleModelCount,
  getProviderPreferredDisplayModelIds,
} from "./model-catalog.js";
import { hasNativeCommand } from "./native-cli.js";

export interface ProviderInfo {
  id: string;
  name: string;
  defaultModel: string;
  models: string[];
}

export type ModelRuntime = "sdk" | "native-cli";

export interface ModelHandle {
  provider: ProviderInfo;
  modelId: string;
  runtime: ModelRuntime;
  model?: LanguageModel;
  nativeCommand?: "claude" | "codex";
}

const PROVIDER_POPULARITY: Record<string, number> = {
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

const LOCAL_PROVIDER_IDS = new Set(["ollama", "lmstudio", "llamacpp", "jan", "vllm"]);

const PROVIDERS: Record<string, ProviderInfo> = {
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

export function shouldUseNativeProvider(providerId: string): boolean {
  if (providerId !== "anthropic" && providerId !== "codex") return false;
  const command = providerId === "anthropic" ? "claude" : "codex";
  return getProviderCredential(providerId).kind === "native_oauth" && hasNativeCommand(command);
}

/** Create a model handle for a provider/model combo */
export function createModel(providerId: string, modelId?: string): ModelHandle {
  const info = PROVIDERS[providerId];
  if (!info) throw new Error(`Unknown provider: ${providerId}`);

  const model = modelId ?? info.defaultModel;

  if (providerId === "anthropic" && shouldUseNativeProvider(providerId)) {
    return {
      provider: { ...info, name: "Claude Code" },
      modelId: model,
      runtime: "native-cli",
      nativeCommand: "claude",
    };
  }

  if (providerId === "codex" && shouldUseNativeProvider(providerId)) {
    return {
      provider: info,
      modelId: model,
      runtime: "native-cli",
      nativeCommand: "codex",
    };
  }

  switch (providerId) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: getApiKey("anthropic") });
      return { model: anthropic(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: getApiKey("openai") });
      return { model: openai.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "codex": {
      const openai = createOpenAI({ apiKey: getApiKey("codex") });
      return { model: openai.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "ollama": {
      const ollama = createOpenAI({
        baseURL: getBaseUrl("ollama") ?? "http://127.0.0.1:11434/v1",
        apiKey: "ollama",
      });
      return { model: ollama.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "lmstudio": {
      const lms = createOpenAI({
        baseURL: getBaseUrl("lmstudio") ?? "http://127.0.0.1:1234/v1",
        apiKey: "lmstudio",
      });
      return { model: lms.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "llamacpp": {
      const llama = createOpenAI({
        baseURL: getBaseUrl("llamacpp") ?? "http://127.0.0.1:8080/v1",
        apiKey: "llamacpp",
      });
      return { model: llama.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "jan": {
      const jan = createOpenAI({
        baseURL: getBaseUrl("jan") ?? "http://127.0.0.1:1337/v1",
        apiKey: "jan",
      });
      return { model: jan.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "vllm": {
      const vllm = createOpenAI({
        baseURL: getBaseUrl("vllm") ?? "http://127.0.0.1:8000/v1",
        apiKey: "vllm",
      });
      return { model: vllm.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey: getApiKey("google") });
      return { model: google(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "mistral": {
      const mistral = createMistral({ apiKey: getApiKey("mistral") });
      return { model: mistral(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "groq": {
      const groq = createOpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: getApiKey("groq"),
      });
      return { model: groq(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "xai": {
      const xai = createXai({ apiKey: getApiKey("xai") });
      return { model: xai(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "openrouter": {
      const or = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: getApiKey("openrouter"),
      });
      return { model: or(model), provider: info, modelId: model, runtime: "sdk" };
    }
    default:
      throw new Error(`No factory for provider: ${providerId}`);
  }
}

export function getProviderInfo(id: string): ProviderInfo | undefined {
  return PROVIDERS[id];
}

export function getProviderPopularity(providerId: string): number {
  return PROVIDER_POPULARITY[providerId] ?? 999;
}

function getNormalizedModelGroup(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/:(free|exacto|beta)$/g, "")
    .replace(/-(latest|beta|preview|preview-[\w-]+)$/g, "")
    .replace(/-\d{8}$/g, "")
    .replace(/-\d{6}$/g, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/g, "")
    .replace(/-(\d+)(?:\.\d+)?-non-reasoning$/g, "-$1")
    .replace(/-non-reasoning$/g, "")
    .replace(/-vision$/g, "")
    .replace(/-image$/g, "");
}

function modelVisibilityScore(providerId: string, modelId: string): number {
  const lower = modelId.toLowerCase();
  let score = 0;
  const preferred = getProviderPreferredDisplayModelIds(providerId);
  const preferredIndex = preferred.indexOf(modelId);
  if (preferredIndex >= 0) score += 500 - preferredIndex * 20;
  if (lower.includes("codex")) score += 120;
  if (lower.includes("codestral")) score += 80;
  if (lower.includes("sonnet")) score += 70;
  if (lower.includes("haiku")) score += 40;
  if (lower.includes("mini")) score += 30;
  if (lower.includes("flash")) score += 25;
  if (lower.includes("latest")) score += 10;
  if (lower.includes("preview")) score -= 40;
  if (/\d{8}/.test(lower) || /\d{6}/.test(lower)) score -= 30;
  return score;
}

export function filterModelIdsForDisplay(providerId: string, modelIds: string[], preserve: string[] = []): string[] {
  if (LOCAL_PROVIDER_IDS.has(providerId)) {
    return [...new Set([...preserve, ...modelIds])];
  }

  const preserveSet = new Set(preserve);
  const seenGroups = new Set<string>();
  const selected: string[] = [];

  const candidates = [...new Set(modelIds)].filter((modelId) => {
    if (preserveSet.has(modelId)) return true;

    const lower = modelId.toLowerCase();
    const spec = getModelSpec(modelId, providerId);
    const family = spec?.family?.toLowerCase() ?? "";
    const inputModalities = spec?.modalities?.input ?? [];
    const outputModalities = spec?.modalities?.output ?? [];

    const excludedById = [
      /(^|\/)(gpt-image|chatgpt-image|pixtral|whisper|tts|transcribe|embedding|moderation|guard|safeguard)/,
      /(^|[-/])(image|vision)([-/]|$)/,
      /(^|[-/])(audio|realtime|live)([-/]|$)/,
      /(^|[-/])(computer-use|search-preview|embedding)([-/]|$)/,
    ].some((pattern) => pattern.test(lower));
    if (excludedById) return false;

    if (["embedding", "text-embedding", "image", "moderation", "speech"].some((kind) => family.includes(kind))) {
      return false;
    }

    if (outputModalities.length > 0 && !outputModalities.includes("text")) return false;
    if (inputModalities.length > 0 && !inputModalities.includes("text")) return false;

    return true;
  });

  candidates.sort((a, b) => {
    const scoreDiff = modelVisibilityScore(providerId, b) - modelVisibilityScore(providerId, a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.localeCompare(b);
  });

  for (const modelId of [...preserve, ...candidates]) {
    if (selected.includes(modelId)) continue;
    const group = getNormalizedModelGroup(modelId);
    if (!preserveSet.has(modelId) && seenGroups.has(group)) continue;
    selected.push(modelId);
    seenGroups.add(group);
  }

  const maxVisible = getProviderMaxVisibleModelCount(providerId);
  const visible = selected.filter((modelId) => preserveSet.has(modelId));
  for (const modelId of selected) {
    if (visible.includes(modelId)) continue;
    if (visible.length >= maxVisible + preserveSet.size) break;
    visible.push(modelId);
  }
  return visible;
}

export function getDisplayModels(providerId: string, preserve: string[] = []): string[] {
  const provider = PROVIDERS[providerId];
  if (!provider) return [];
  return filterModelIdsForDisplay(providerId, provider.models, preserve);
}

export function syncCloudProviderModelsFromCatalog(): void {
  const mappings: Array<{ providerId: string; catalogProviderId?: string }> = [
    { providerId: "anthropic" },
    { providerId: "openai" },
    { providerId: "codex", catalogProviderId: "openai" },
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

  // Try OpenAI-compatible /v1/models
  const openaiData = await fetchUrl(`${baseURL}/models`) as { data?: Array<{ id: string }> } | null;
  if (openaiData?.data) {
    for (const m of openaiData.data) {
      if (m.id && !models.includes(m.id)) models.push(m.id);
    }
  }

  // For Ollama, also try /api/tags which lists all downloaded models
  if (id === "ollama") {
    const host = baseURL.replace("/v1", "");
    const tagsData = await fetchUrl(`${host}/api/tags`) as { models?: Array<{ name: string }> } | null;
    if (tagsData?.models) {
      for (const m of tagsData.models) {
        if (m.name && !models.includes(m.name)) models.push(m.name);
      }
    }
  }

  // For llama.cpp, also check /models and /slots endpoints
  if (id === "llamacpp") {
    const host = baseURL.replace("/v1", "");
    const modelsData = await fetchUrl(`${host}/models`) as { models?: Array<{ name: string; model: string }> } | null;
    if (modelsData?.models) {
      for (const m of modelsData.models) {
        const name = m.model || m.name;
        if (name && !models.includes(name)) models.push(name);
      }
    }
    // /slots shows currently loaded model slots
    const slotsData = await fetchUrl(`${host}/slots`) as Array<{ model: string }> | null;
    if (Array.isArray(slotsData)) {
      for (const s of slotsData) {
        if (s.model && !models.includes(s.model)) models.push(s.model);
      }
    }
  }

  // For LM Studio, also check /lmstudio/models endpoint
  if (id === "lmstudio") {
    const host = baseURL.replace("/v1", "");
    const lmsData = await fetchUrl(`${host}/lmstudio/models`) as { data?: Array<{ id: string }> } | null;
    if (lmsData?.data) {
      for (const m of lmsData.data) {
        if (m.id && !models.includes(m.id)) models.push(m.id);
      }
    }
  }

  return models;
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
      const models = await fetchLocalModels(id, getBaseUrl(id) ?? localProviders[id]);
      if (models.length > 0 && PROVIDERS[id]) {
        PROVIDERS[id].models = models;
        PROVIDERS[id].defaultModel = models[0];
      }
    });

  await Promise.all(fetches);
}

export function listProviders(): ProviderInfo[] {
  return Object.values(PROVIDERS);
}
