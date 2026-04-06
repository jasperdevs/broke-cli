import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as parseJsonc } from "jsonc-parser";

export type Mode = "build" | "plan";
export type FollowUpMode = "immediate" | "after_tool" | "after_response";
export type ThinkingLevel = "off" | "low" | "medium" | "high";
export type CavemanLevel = "off" | "lite" | "auto" | "ultra";

export interface Settings {
  yoloMode: boolean;
  autoCompact: boolean;
  maxSessionCost: number;
  showTokens: boolean;
  showCost: boolean;
  autoSaveSessions: boolean;
  enableThinking: boolean;
  thinkingLevel: ThinkingLevel;
  gitCheckpoints: boolean;
  notifyOnResponse: boolean;
  hideSidebar: boolean;
  autoRoute: boolean;
  scopedModels: string[];
  favoriteThemes: string[];
  lastModel: string;
  mode: Mode;
  followUpMode: FollowUpMode;
  cavemanLevel: CavemanLevel;
  theme: string;
}

export const DEFAULT_SETTINGS: Settings = {
  yoloMode: true,
  autoCompact: true,
  maxSessionCost: 0,
  showTokens: true,
  showCost: true,
  autoSaveSessions: true,
  enableThinking: false,
  thinkingLevel: "off" as ThinkingLevel,
  gitCheckpoints: true,
  notifyOnResponse: false,
  hideSidebar: false,
  autoRoute: true,
  scopedModels: [],
  favoriteThemes: [],
  lastModel: "",
  mode: "build",
  followUpMode: "after_response",
  cavemanLevel: "off",
  theme: "brokecli-dark",
};

export interface BrokeConfig {
  defaultProvider?: string;
  defaultModel?: string;
  budget?: { maxSessionCost?: number; maxMonthlyCost?: number };
  providers?: Record<string, { apiKey?: string; baseUrl?: string; disabled?: boolean }>;
  modelContextLimits?: Record<string, number>;
  settings?: Partial<Settings>;
}

export type ProviderCredentialKind = "api_key" | "native_oauth" | "none";

export interface ProviderCredential {
  kind: ProviderCredentialKind;
  value?: string;
  source?: string;
}

const CONFIG_DIR = join(homedir(), ".brokecli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

let cached: BrokeConfig | null = null;

export function loadConfig(): BrokeConfig {
  if (cached) return cached;
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      cached = parseJsonc(raw) ?? {};
    } catch {
      cached = {};
    }
  } else {
    cached = {};
  }
  return cached!;
}

export function getSettings(): Settings {
  const config = loadConfig();
  return { ...DEFAULT_SETTINGS, ...config.settings };
}

export function updateSetting(key: keyof Settings, value: unknown): void {
  const config = loadConfig();
  if (!config.settings) config.settings = {};
  (config.settings as Record<string, unknown>)[key] = value;
  cached = config;
  saveConfig(config);
}

function saveConfig(config: BrokeConfig): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch { /* silent */ }
}

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

export function getProviderCredential(provider: string): ProviderCredential {
  const config = loadConfig();
  const fromConfig = config.providers?.[provider]?.apiKey;
  if (fromConfig) return { kind: "api_key", value: fromConfig, source: "config" };

  switch (provider) {
    case "anthropic":
      if (process.env.ANTHROPIC_API_KEY) return { kind: "api_key", value: process.env.ANTHROPIC_API_KEY, source: "env" };
      return readClaudeCredential();
    case "openai":
      return process.env.OPENAI_API_KEY
        ? { kind: "api_key", value: process.env.OPENAI_API_KEY, source: "env" }
        : { kind: "none" };
    case "codex":
      return readCodexCredential();
    case "google":
      return process.env.GOOGLE_API_KEY
        ? { kind: "api_key", value: process.env.GOOGLE_API_KEY, source: "env" }
        : process.env.GOOGLE_GENERATIVE_AI_API_KEY
          ? { kind: "api_key", value: process.env.GOOGLE_GENERATIVE_AI_API_KEY, source: "env" }
          : { kind: "none" };
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

export function getBaseUrl(provider: string): string | undefined {
  const config = loadConfig();
  return config.providers?.[provider]?.baseUrl;
}

export function updateProviderConfig(
  provider: string,
  updates: { apiKey?: string | null; baseUrl?: string | null; disabled?: boolean | null },
): void {
  const config = loadConfig();
  if (!config.providers) config.providers = {};
  const existing = { ...(config.providers[provider] ?? {}) };

  if ("apiKey" in updates) {
    if (updates.apiKey == null) delete existing.apiKey;
    else existing.apiKey = updates.apiKey;
  }

  if ("baseUrl" in updates) {
    if (updates.baseUrl == null) delete existing.baseUrl;
    else existing.baseUrl = updates.baseUrl;
  }

  if ("disabled" in updates) {
    if (updates.disabled == null) delete existing.disabled;
    else existing.disabled = updates.disabled;
  }

  config.providers[provider] = existing;
  cached = config;
  saveConfig(config);
}

export function getModelContextLimitOverride(provider: string, model: string): number | undefined {
  const config = loadConfig();
  return config.modelContextLimits?.[`${provider}/${model}`] ?? config.modelContextLimits?.[model];
}
