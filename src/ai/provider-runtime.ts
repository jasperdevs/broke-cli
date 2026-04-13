import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { getApiKey, getProviderCredential } from "../core/provider-credentials.js";
import { getProviderNativeDefaultModelId, getProviderNativePreferredDisplayModelIds } from "./model-catalog.js";
import { hasNativeCommand } from "./native-cli.js";
import { type ModelHandle, PROVIDERS, type ProviderInfo } from "./provider-definitions.js";
import {
  getConfiguredProviderAuthHeader,
  getConfiguredProviderBaseUrl,
  getConfiguredProviderHeaders,
} from "../core/models-config.js";
import { applyConfiguredProviderOverrides } from "./provider-overrides.js";

export function resolveProviderSdkConfig(providerId: string, info: ProviderInfo): {
  baseURL?: string;
  headers?: Record<string, string>;
  apiKey?: string;
} {
  const baseURL = info.baseUrl ?? getConfiguredProviderBaseUrl(providerId);
  const mergedHeaders = {
    ...(info.headers ?? {}),
    ...(getConfiguredProviderHeaders(providerId) ?? {}),
  };
  const headers = Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined;
  const apiKey = getApiKey(providerId) ?? (getConfiguredProviderAuthHeader(providerId) ? "" : undefined);
  return { baseURL, headers, apiKey };
}

export function shouldUseNativeProvider(providerId: string): boolean {
  if (providerId !== "anthropic" && providerId !== "codex") return false;
  const command = providerId === "anthropic" ? "claude" : "codex";
  return getProviderCredential(providerId).kind === "native_oauth" && hasNativeCommand(command);
}

export function createModel(providerId: string, modelId?: string): ModelHandle {
  let info = PROVIDERS[providerId];
  if (!info) {
    applyConfiguredProviderOverrides();
    info = PROVIDERS[providerId];
  }
  if (!info) throw new Error(`Unknown provider: ${providerId}`);

  const useNative = shouldUseNativeProvider(providerId);
  const nativeDefaultModel = useNative
    ? getProviderNativeDefaultModelId(providerId) ?? info.defaultModel
    : info.defaultModel;
  const model = modelId ?? nativeDefaultModel;

  if (providerId === "anthropic" && useNative) {
    return {
      provider: { ...info, name: "Claude Code", defaultModel: nativeDefaultModel },
      modelId: model,
      runtime: "native-cli",
      nativeCommand: "claude",
    };
  }

  if (providerId === "codex" && useNative) {
    const supportedNativeModels = getProviderNativePreferredDisplayModelIds(providerId);
    const resolvedModel = supportedNativeModels.includes(model) ? model : nativeDefaultModel;
    return {
      provider: { ...info, defaultModel: nativeDefaultModel, models: supportedNativeModels },
      modelId: resolvedModel,
      runtime: "native-cli",
      nativeCommand: "codex",
    };
  }

  if (info.custom && info.apiType) {
    const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
    switch (info.apiType) {
      case "openai-completions": {
        const openai = createOpenAI({ baseURL, apiKey: apiKey ?? "configured-provider", headers });
        return { model: openai.chat(model), provider: info, modelId: model, runtime: "sdk" };
      }
      case "anthropic-messages": {
        const anthropic = createAnthropic({ baseURL, apiKey: apiKey ?? "configured-provider", headers });
        return { model: anthropic(model), provider: info, modelId: model, runtime: "sdk" };
      }
      case "google-generative-ai": {
        const google = createGoogleGenerativeAI({ baseURL, apiKey: apiKey ?? "configured-provider", headers });
        return { model: google(model), provider: info, modelId: model, runtime: "sdk" };
      }
      default:
        throw new Error(`Unsupported custom provider API: ${info.apiType}`);
    }
  }

  switch (providerId) {
    case "anthropic": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const anthropic = createAnthropic({ apiKey, baseURL, headers });
      return { model: anthropic(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "openai": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const openai = createOpenAI({ apiKey, baseURL, headers });
      return { model: openai.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "codex": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const openai = createOpenAI({ apiKey, baseURL, headers });
      return { model: openai.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "ollama": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const ollama = createOpenAI({
        baseURL: baseURL ?? "http://127.0.0.1:11434/v1",
        apiKey: apiKey ?? "ollama",
        headers,
      });
      return { model: ollama.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "lmstudio": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const lms = createOpenAI({
        baseURL: baseURL ?? "http://127.0.0.1:1234/v1",
        apiKey: apiKey ?? "lmstudio",
        headers,
      });
      return { model: lms.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "llamacpp": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const llama = createOpenAI({
        baseURL: baseURL ?? "http://127.0.0.1:8080/v1",
        apiKey: apiKey ?? "llamacpp",
        headers,
      });
      return { model: llama.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "jan": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const jan = createOpenAI({
        baseURL: baseURL ?? "http://127.0.0.1:1337/v1",
        apiKey: apiKey ?? "jan",
        headers,
      });
      return { model: jan.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "vllm": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const vllm = createOpenAI({
        baseURL: baseURL ?? "http://127.0.0.1:8000/v1",
        apiKey: apiKey ?? "vllm",
        headers,
      });
      return { model: vllm.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "google": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const google = createGoogleGenerativeAI({ apiKey, baseURL, headers });
      return { model: google(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "mistral": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const mistral = createMistral({ apiKey, baseURL, headers });
      return { model: mistral(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "groq": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const groq = createOpenAI({
        baseURL: baseURL ?? "https://api.groq.com/openai/v1",
        apiKey,
        headers,
      });
      return { model: groq(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "xai": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const xai = createXai({ apiKey, baseURL, headers });
      return { model: xai(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "openrouter": {
      const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
      const openrouter = createOpenAI({
        baseURL: baseURL ?? "https://openrouter.ai/api/v1",
        apiKey,
        headers,
      });
      return { model: openrouter(model), provider: info, modelId: model, runtime: "sdk" };
    }
    default:
      throw new Error(`No factory for provider: ${providerId}`);
  }
}
