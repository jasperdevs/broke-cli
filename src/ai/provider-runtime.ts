import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { getBaseUrl } from "../core/config.js";
import { getApiKey, getProviderCredential } from "../core/provider-credentials.js";
import { getProviderNativeDefaultModelId } from "./model-catalog.js";
import { hasNativeCommand } from "./native-cli.js";
import { type ModelHandle, PROVIDERS } from "./provider-definitions.js";

export function shouldUseNativeProvider(providerId: string): boolean {
  if (providerId !== "anthropic" && providerId !== "codex") return false;
  const command = providerId === "anthropic" ? "claude" : "codex";
  return getProviderCredential(providerId).kind === "native_oauth" && hasNativeCommand(command);
}

export function createModel(providerId: string, modelId?: string): ModelHandle {
  const info = PROVIDERS[providerId];
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
    return {
      provider: { ...info, defaultModel: nativeDefaultModel },
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
      const openrouter = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: getApiKey("openrouter"),
      });
      return { model: openrouter(model), provider: info, modelId: model, runtime: "sdk" };
    }
    default:
      throw new Error(`No factory for provider: ${providerId}`);
  }
}
