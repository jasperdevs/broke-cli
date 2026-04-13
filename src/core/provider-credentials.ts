import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
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
  if (typeof explicitApiKey === "string" && explicitApiKey.trim().length > 10) {
    return { kind: "api_key", value: explicitApiKey.trim(), source: "claude-credentials" };
  }
  const explicitEnvKey = record.ANTHROPIC_API_KEY;
  if (typeof explicitEnvKey === "string" && explicitEnvKey.trim().length > 10) {
    return { kind: "api_key", value: explicitEnvKey.trim(), source: "claude-credentials" };
  }
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
  if (typeof apiKey === "string" && apiKey.trim().length > 10) {
    return { kind: "api_key", value: apiKey.trim(), source: "codex-auth" };
  }
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

    const apiKeyFiles = ["api_key", ".claude_api_key"];
    for (const file of apiKeyFiles) {
      const path = join(claudeDir, file);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf-8").trim();
      if (content.length > 10 && !content.includes("\n")) {
        return { kind: "api_key", value: content, source: `claude:${file}` };
      }
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
  const envToken = process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken?.trim()) {
    return { kind: "native_oauth", value: envToken.trim(), source: "env" };
  }
  const stored = getCredentials("github-copilot");
  if (stored) {
    return { kind: "native_oauth", value: stored, source: "brokecli-auth" };
  }
  try {
    const result = spawnSync("gh", ["auth", "token", "--hostname", "github.com"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && !result.error) {
      const token = result.stdout.trim();
      if (token) return { kind: "native_oauth", value: token, source: "gh-auth" };
    }
  } catch {
    // ignore
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
  const runtimeApiKey = getRuntimeProviderApiKey(provider);
  if (runtimeApiKey) return { kind: "api_key", value: runtimeApiKey, source: "runtime" };
  const config = loadConfig();
  const fromConfig = config.providers?.[provider]?.apiKey;
  if (fromConfig) return { kind: "api_key", value: fromConfig, source: "config" };
  const fromModelsConfig = getConfiguredProviderApiKey(provider);
  if (fromModelsConfig) return { kind: "api_key", value: fromModelsConfig, source: "models-config" };

  switch (provider) {
    case "anthropic":
      if (process.env.ANTHROPIC_API_KEY) return { kind: "api_key", value: process.env.ANTHROPIC_API_KEY, source: "env" };
      {
        const credential = readClaudeCredential();
        return credential.kind !== "none" ? credential : readStoredOauthCredential("anthropic");
      }
    case "openai":
      return process.env.OPENAI_API_KEY
        ? { kind: "api_key", value: process.env.OPENAI_API_KEY, source: "env" }
        : { kind: "none" };
    case "codex":
      {
        const credential = readCodexCredential();
        return credential.kind !== "none" ? credential : readStoredOauthCredential("codex");
      }
    case "github-copilot":
      return readGitHubCopilotCredential();
    case "google":
      return process.env.GOOGLE_API_KEY
        ? { kind: "api_key", value: process.env.GOOGLE_API_KEY, source: "env" }
        : process.env.GOOGLE_GENERATIVE_AI_API_KEY
          ? { kind: "api_key", value: process.env.GOOGLE_GENERATIVE_AI_API_KEY, source: "env" }
          : { kind: "none" };
    case "google-gemini-cli":
    case "google-antigravity":
      return readStoredOauthCredential(provider);
    case "groq":
      return process.env.GROQ_API_KEY
        ? { kind: "api_key", value: process.env.GROQ_API_KEY, source: "env" }
        : { kind: "none" };
    case "mistral":
      return process.env.MISTRAL_API_KEY
        ? { kind: "api_key", value: process.env.MISTRAL_API_KEY, source: "env" }
        : { kind: "none" };
    case "xai":
      return process.env.XAI_API_KEY
        ? { kind: "api_key", value: process.env.XAI_API_KEY, source: "env" }
        : { kind: "none" };
    case "openrouter":
      return process.env.OPENROUTER_API_KEY
        ? { kind: "api_key", value: process.env.OPENROUTER_API_KEY, source: "env" }
        : { kind: "none" };
    default:
      return { kind: "none" };
  }
}

export function getApiKey(provider: string): string | undefined {
  const credential = getProviderCredential(provider);
  return credential.kind === "api_key" ? credential.value : undefined;
}

export { clearRuntimeProviderApiKeys, setRuntimeProviderApiKey };
