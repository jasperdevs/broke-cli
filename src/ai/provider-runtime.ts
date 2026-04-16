import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { getApiKey, getProviderCredential } from "../core/provider-credentials.js";
import { getProviderNativeDefaultModelId, getProviderNativePreferredDisplayModelIds } from "./model-catalog.js";
import { hasNativeCommand } from "./native-cli.js";
import { LOCAL_PROVIDER_IDS, type ModelHandle, PROVIDERS, type ProviderInfo } from "./provider-definitions.js";
import {
  getConfiguredProviderAuthHeader,
  getConfiguredProviderBaseUrl,
  getConfiguredProviderHeaders,
} from "../core/models-config.js";
import { applyConfiguredProviderOverrides } from "./provider-overrides.js";

const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
} as const;

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

export function isProviderRuntimeSelectable(providerId: string): boolean {
  if (LOCAL_PROVIDER_IDS.has(providerId)) return true;
  if (providerId === "anthropic" || providerId === "codex") return shouldUseNativeProvider(providerId);
  return providerId === "github-copilot" && getProviderCredential(providerId).kind === "native_oauth";
}

function parseCredentialValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { access?: string; token?: string };
    return parsed.access?.trim() || parsed.token?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

function getOAuthAccessToken(providerId: string): string {
  const credential = getProviderCredential(providerId);
  if (credential.kind !== "native_oauth" || !credential.value) {
    throw new Error(`${providerId} OAuth login is missing. Run /login ${providerId}.`);
  }
  return parseCredentialValue(credential.value);
}

function getGitHubCopilotBaseUrl(token: string): string {
  const proxyMatch = token.match(/proxy-ep=([^;]+)/);
  if (!proxyMatch) return "https://api.individual.githubcopilot.com";
  return `https://${proxyMatch[1]!.replace(/^proxy\./, "api.")}`;
}

export function createModel(providerId: string, modelId?: string): ModelHandle {
  let info = PROVIDERS[providerId];
  if (!info) {
    applyConfiguredProviderOverrides();
    info = PROVIDERS[providerId];
  }
  if (!info) throw new Error(`Unknown provider: ${providerId}`);

  const useNative = shouldUseNativeProvider(providerId);
  const credential = getProviderCredential(providerId);
  if ((providerId === "anthropic" || providerId === "codex") && credential.kind === "native_oauth" && !useNative) {
    const command = providerId === "anthropic" ? "claude" : "codex";
    throw new Error(`${info.name} login found, but the ${command} CLI is not on PATH.`);
  }
  if (!useNative) {
    if (providerId !== "github-copilot") {
      throw new Error(`${info.name} API-key runtime is disabled. Use /login with an OAuth provider.`);
    }
  }
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

  if (providerId === "github-copilot") {
    const token = getOAuthAccessToken(providerId);
    if (!token.includes("proxy-ep=") && !token.startsWith("ghu_") && !token.startsWith("gho_")) {
      throw new Error("GitHub Copilot OAuth token is invalid. Run /login github-copilot again.");
    }
    if (!token.includes("proxy-ep=")) {
      throw new Error("GitHub login found, but no Copilot API token is stored. Run /login github-copilot again.");
    }
    const baseURL = getGitHubCopilotBaseUrl(token);
    const provider = { ...info, baseUrl: baseURL, headers: { ...COPILOT_HEADERS } };
    if (model.startsWith("claude-")) {
      const anthropic = createAnthropic({ apiKey: token, baseURL, headers: { ...COPILOT_HEADERS } });
      return { model: anthropic(model), provider, modelId: model, runtime: "sdk" };
    }
    const copilot = createOpenAI({ apiKey: token, baseURL, headers: { ...COPILOT_HEADERS } });
    return { model: copilot.chat(model), provider, modelId: model, runtime: "sdk" };
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
