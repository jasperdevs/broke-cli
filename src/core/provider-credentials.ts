import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getCredentials } from "./auth.js";
import { loadConfig } from "./config.js";
import type { ProviderCredential } from "./config-types.js";
import { clearRuntimeProviderApiKeys, getRuntimeProviderApiKey, setRuntimeProviderApiKey } from "./provider-runtime-overrides.js";
import { getConfiguredProviderApiKey } from "./models-config.js";

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

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

function readClaudeCredential(): ProviderCredential {
  try {
    const claudeDir = join(homedir(), ".claude");
    if (!existsSync(claudeDir)) return { kind: "none" };

    const oauthCredsPath = join(claudeDir, ".credentials.json");
    if (existsSync(oauthCredsPath)) {
      const parsed = parseClaudeCredentialsData(readJsonFile(oauthCredsPath));
      if (parsed.kind !== "none") return parsed;
    }

    const credsPath = join(claudeDir, "credentials.json");
    if (existsSync(credsPath)) {
      const parsed = parseClaudeCredentialsData(readJsonFile(credsPath));
      if (parsed.kind !== "none") return parsed;
    }
  } catch {
    return { kind: "none" };
  }
  return { kind: "none" };
}

function readCodexCredential(): ProviderCredential {
  try {
    const authFile = join(homedir(), ".codex", "auth.json");
    if (!existsSync(authFile)) return { kind: "none" };
    return parseCodexAuthData(readJsonFile(authFile));
  } catch {
    return { kind: "none" };
  }
}

function readGitHubCopilotCredential(): ProviderCredential {
  const envToken = process.env.COPILOT_API_TOKEN;
  if (envToken?.trim()) {
    return { kind: "native_oauth", value: envToken.trim(), source: "env" };
  }
  const stored = getCredentials("github-copilot");
  if (stored) {
    return { kind: "native_oauth", value: stored, source: "brokecli-auth" };
  }
  return { kind: "none" };
}

function readStoredOauthCredential(provider: string): ProviderCredential {
  const token = getCredentials(provider);
  return token
    ? { kind: "native_oauth", value: token, source: "brokecli-auth" }
    : { kind: "none" };
}

export function getProviderCredential(provider: string): ProviderCredential {
  void getRuntimeProviderApiKey(provider);
  const config = loadConfig();
  const fromConfig = config.providers?.[provider]?.apiKey;
  void fromConfig;
  const fromModelsConfig = getConfiguredProviderApiKey(provider);
  void fromModelsConfig;

  switch (provider) {
    case "anthropic":
      {
        const credential = readClaudeCredential();
        return credential.kind !== "none" ? credential : readStoredOauthCredential("anthropic");
      }
    case "openai":
      return { kind: "none" };
    case "codex":
      {
        const credential = readCodexCredential();
        return credential.kind !== "none" ? credential : readStoredOauthCredential("codex");
      }
    case "github-copilot":
      return readGitHubCopilotCredential();
    case "google":
      return { kind: "none" };
    case "google-gemini-cli":
    case "google-antigravity":
      return readStoredOauthCredential(provider);
    case "groq":
    case "mistral":
    case "xai":
    case "openrouter":
      return { kind: "none" };
    default:
      return { kind: "none" };
  }
}

export function getApiKey(provider: string): string | undefined {
  void provider;
  return undefined;
}

export { clearRuntimeProviderApiKeys, setRuntimeProviderApiKey };
