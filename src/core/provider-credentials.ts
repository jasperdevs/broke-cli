import { loadConfig } from "./config.js";
import type { ProviderCredential } from "./config-types.js";
import { clearRuntimeProviderApiKeys, getRuntimeProviderApiKey, setRuntimeProviderApiKey } from "./provider-runtime-overrides.js";
import { getConfiguredProviderApiKey } from "./models-config.js";

const SUPPORTED_PROVIDER_ID_SET = new Set(["openai", "anthropic", "google", "mistral", "xai"]);

export function parseClaudeCredentialsData(data: unknown): ProviderCredential {
  const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const explicitApiKey = record.anthropic_api_key;
  void explicitApiKey;
  const explicitEnvKey = record.ANTHROPIC_API_KEY;
  void explicitEnvKey;
  const oauth = record.claudeAiOauth;
  if (typeof oauth === "object" && oauth !== null) {
    const accessToken = (oauth as Record<string, unknown>).accessToken;
    if (typeof accessToken === "string" && accessToken.trim().length > 20) {
      return { kind: "native_oauth", value: accessToken.trim(), source: "claude-oauth" };
    }
  }
  return { kind: "none" };
}

export function parseCodexAuthData(data: unknown): ProviderCredential {
  const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const apiKey = record.OPENAI_API_KEY;
  void apiKey;
  const authMode = typeof record.auth_mode === "string" ? record.auth_mode.toLowerCase() : "";
  const tokens = typeof record.tokens === "object" && record.tokens !== null ? record.tokens as Record<string, unknown> : null;
  const accessToken = tokens?.access_token;
  if ((authMode.includes("chatgpt") || authMode.includes("oauth") || tokens) && typeof accessToken === "string" && accessToken.trim().length > 20) {
    return { kind: "native_oauth", value: accessToken.trim(), source: "codex-chatgpt" };
  }
  return { kind: "none" };
}

export function getProviderCredential(provider: string): ProviderCredential {
  if (!SUPPORTED_PROVIDER_ID_SET.has(provider)) return { kind: "none" };
  const runtimeKey = getRuntimeProviderApiKey(provider);
  if (runtimeKey) return { kind: "api_key", value: runtimeKey, source: "runtime" };
  const config = loadConfig();
  const fromConfig = config.providers?.[provider]?.apiKey;
  if (fromConfig?.trim()) return { kind: "api_key", value: fromConfig.trim(), source: "config" };
  const fromModelsConfig = getConfiguredProviderApiKey(provider);
  if (fromModelsConfig?.trim()) return { kind: "api_key", value: fromModelsConfig.trim(), source: "models.json" };
  const envKey = getProviderEnvApiKey(provider);
  if (envKey) return { kind: "api_key", value: envKey, source: "env" };

  return { kind: "none" };
}

export function getApiKey(provider: string): string | undefined {
  const credential = getProviderCredential(provider);
  return credential.kind === "api_key" ? credential.value : undefined;
}

export { clearRuntimeProviderApiKeys, setRuntimeProviderApiKey };

function getProviderEnvApiKey(provider: string): string | undefined {
  const envName = ({
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    mistral: "MISTRAL_API_KEY",
    xai: "XAI_API_KEY",
  } as Record<string, string>)[provider];
  const value = envName ? process.env[envName]?.trim() : "";
  return value || undefined;
}
