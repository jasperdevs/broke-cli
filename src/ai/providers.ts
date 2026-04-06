import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import { getApiKey, getBaseUrl } from "../core/config.js";

export interface ProviderInfo {
  id: string;
  name: string;
  defaultModel: string;
  models: string[];
}

const PROVIDERS: Record<string, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    defaultModel: "claude-sonnet-4-6",
    models: [
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-6",
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o3-mini"],
  },
  codex: {
    id: "codex",
    name: "Codex",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o3-mini"],
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
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
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
    defaultModel: "anthropic/claude-sonnet-4",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-flash"],
  },
};

/** Create a LanguageModel instance for a provider/model combo */
export function createModel(providerId: string, modelId?: string): { model: LanguageModel; provider: ProviderInfo } {
  const info = PROVIDERS[providerId];
  if (!info) throw new Error(`Unknown provider: ${providerId}`);

  const model = modelId ?? info.defaultModel;

  switch (providerId) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: getApiKey("anthropic") });
      return { model: anthropic(model), provider: info };
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: getApiKey("openai") });
      return { model: openai.chat(model), provider: info };
    }
    case "codex": {
      const openai = createOpenAI({ apiKey: getApiKey("codex") });
      return { model: openai.chat(model), provider: info };
    }
    case "ollama": {
      const ollama = createOpenAI({
        baseURL: getBaseUrl("ollama") ?? "http://127.0.0.1:11434/v1",
        apiKey: "ollama",
      });
      return { model: ollama.chat(model), provider: info };
    }
    case "lmstudio": {
      const lms = createOpenAI({
        baseURL: getBaseUrl("lmstudio") ?? "http://127.0.0.1:1234/v1",
        apiKey: "lmstudio",
      });
      return { model: lms.chat(model), provider: info };
    }
    case "llamacpp": {
      const llama = createOpenAI({
        baseURL: getBaseUrl("llamacpp") ?? "http://127.0.0.1:8080/v1",
        apiKey: "llamacpp",
      });
      return { model: llama.chat(model), provider: info };
    }
    case "jan": {
      const jan = createOpenAI({
        baseURL: getBaseUrl("jan") ?? "http://127.0.0.1:1337/v1",
        apiKey: "jan",
      });
      return { model: jan.chat(model), provider: info };
    }
    case "vllm": {
      const vllm = createOpenAI({
        baseURL: getBaseUrl("vllm") ?? "http://127.0.0.1:8000/v1",
        apiKey: "vllm",
      });
      return { model: vllm.chat(model), provider: info };
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey: getApiKey("google") });
      return { model: google(model), provider: info };
    }
    case "mistral": {
      const mistral = createMistral({ apiKey: getApiKey("mistral") });
      return { model: mistral(model), provider: info };
    }
    case "groq": {
      const groq = createOpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: getApiKey("groq"),
      });
      return { model: groq(model), provider: info };
    }
    case "xai": {
      const xai = createXai({ apiKey: getApiKey("xai") });
      return { model: xai(model), provider: info };
    }
    case "openrouter": {
      const or = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: getApiKey("openrouter"),
      });
      return { model: or(model), provider: info };
    }
    default:
      throw new Error(`No factory for provider: ${providerId}`);
  }
}

export function getProviderInfo(id: string): ProviderInfo | undefined {
  return PROVIDERS[id];
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
      const models = await fetchLocalModels(id, localProviders[id]);
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
