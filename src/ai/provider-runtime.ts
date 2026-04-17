import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { getApiKey } from "../core/provider-credentials.js";
import {
  getConfiguredProviderBaseUrl,
  getConfiguredProviderHeaders,
} from "../core/models-config.js";
import { type ModelHandle, PROVIDERS, SUPPORTED_PROVIDER_ID_SET, type ProviderInfo } from "./provider-definitions.js";

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
  const apiKey = getApiKey(providerId);
  return { baseURL, headers, apiKey };
}

export function shouldUseNativeProvider(providerId: string): boolean {
  void providerId;
  return false;
}

export function isProviderRuntimeSelectable(providerId: string): boolean {
  return SUPPORTED_PROVIDER_ID_SET.has(providerId);
}

export function createModel(providerId: string, modelId?: string): ModelHandle {
  if (!SUPPORTED_PROVIDER_ID_SET.has(providerId)) {
    throw new Error(`Unsupported provider: ${providerId}. Supported providers: openai, anthropic, google, mistral, xai.`);
  }
  const info = PROVIDERS[providerId];
  if (!info) throw new Error(`Unknown provider: ${providerId}`);

  const model = modelId ?? info.defaultModel;
  const { baseURL, headers, apiKey } = resolveProviderSdkConfig(providerId, info);
  if (!apiKey) {
    throw new Error(`${info.name} API key is missing. Configure ${providerId} auth before using this provider.`);
  }

  switch (providerId) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey, baseURL, headers });
      return { model: anthropic(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "openai": {
      const openai = createOpenAI({ apiKey, baseURL, headers });
      return { model: openai.chat(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey, baseURL, headers });
      return { model: google(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "mistral": {
      const mistral = createMistral({ apiKey, baseURL, headers });
      return { model: mistral(model), provider: info, modelId: model, runtime: "sdk" };
    }
    case "xai": {
      const xai = createXai({ apiKey, baseURL, headers });
      return { model: xai(model), provider: info, modelId: model, runtime: "sdk" };
    }
    default:
      throw new Error(`No factory for provider: ${providerId}`);
  }
}
