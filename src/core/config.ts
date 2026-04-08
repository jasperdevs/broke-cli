import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import { join, resolve } from "path";
import { homedir } from "os";
import { parse as parseJsonc } from "jsonc-parser";
import { getCredentials } from "./auth.js";
export type {
  Mode,
  ModeSwitchingPolicy,
  ThinkingLevel,
  CavemanLevel,
  TreeFilterMode,
  ModelPreferenceSlot,
  PackageFilterSource,
  PackageSource,
  CompactionSettings,
  RetrySettings,
  TerminalSettings,
  ImageSettings,
  MarkdownSettings,
  Settings,
  BrokeConfig,
  ProviderCredentialKind,
  ProviderCredential,
} from "./config-types.js";
export { DEFAULT_SETTINGS } from "./config-defaults.js";
import { DEFAULT_SETTINGS } from "./config-defaults.js";
import type { BrokeConfig, ModelPreferenceSlot, ProviderCredential, Settings } from "./config-types.js";

const CONFIG_DIR = join(homedir(), ".brokecli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

let cachedGlobal: BrokeConfig | null = null;
let cachedProject: { cwd: string; config: BrokeConfig } | null = null;
let cachedMerged: BrokeConfig | null = null;
let runtimeSettings: Partial<Settings> = {};
const runtimeProviderApiKeys = new Map<string, string>();

function mergeSettings(base: Partial<Settings> | undefined, override: Partial<Settings> | undefined): Partial<Settings> {
  return {
    ...(base ?? {}),
    ...(override ?? {}),
    thinkingBudgets: { ...(base?.thinkingBudgets ?? {}), ...(override?.thinkingBudgets ?? {}) },
    compaction: { ...(base?.compaction ?? {}), ...(override?.compaction ?? {}) },
    retry: { ...(base?.retry ?? {}), ...(override?.retry ?? {}) },
    terminal: { ...(base?.terminal ?? {}), ...(override?.terminal ?? {}) },
    images: { ...(base?.images ?? {}), ...(override?.images ?? {}) },
    markdown: { ...(base?.markdown ?? {}), ...(override?.markdown ?? {}) },
  } as Partial<Settings>;
}

function mergeConfigs(base: BrokeConfig, override: BrokeConfig): BrokeConfig {
  return {
    ...base,
    ...override,
    budget: { ...(base.budget ?? {}), ...(override.budget ?? {}) },
    providers: { ...(base.providers ?? {}), ...(override.providers ?? {}) },
    modelContextLimits: { ...(base.modelContextLimits ?? {}), ...(override.modelContextLimits ?? {}) },
    settings: mergeSettings(base.settings, override.settings),
  };
}

function readConfigFile(path: string): BrokeConfig {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    return parseJsonc(raw) ?? {};
  } catch {
    return {};
  }
}

function invalidateConfigCache(): void {
  cachedGlobal = null;
  cachedProject = null;
  cachedMerged = null;
}

export function getGlobalConfigPath(): string {
  return CONFIG_FILE;
}

export function getProjectConfigPath(cwd = process.cwd()): string {
  return join(resolve(cwd, ".brokecli"), "config.json");
}

export function loadGlobalConfig(): BrokeConfig {
  if (!cachedGlobal) cachedGlobal = readConfigFile(CONFIG_FILE);
  return cachedGlobal;
}

export function loadProjectConfig(cwd = process.cwd()): BrokeConfig {
  const projectFile = getProjectConfigPath(cwd);
  if (cwd === process.cwd()) {
    if (!cachedProject || cachedProject.cwd !== cwd) cachedProject = { cwd, config: readConfigFile(projectFile) };
    return cachedProject.config;
  }
  return readConfigFile(projectFile);
}

export function loadConfig(): BrokeConfig {
  if (!cachedMerged) {
    cachedMerged = mergeConfigs(loadGlobalConfig(), loadProjectConfig());
  }
  return cachedMerged;
}

export function getSettings(): Settings {
  const config = loadConfig();
  const legacyDisabledTools = Array.isArray((config.settings as Record<string, unknown> | undefined)?.deniedTools)
    ? ((config.settings as Record<string, unknown>).deniedTools as string[])
    : [];
  const merged = {
    ...DEFAULT_SETTINGS,
    ...mergeSettings(DEFAULT_SETTINGS, config.settings),
    ...runtimeSettings,
    thinkingBudgets: { ...DEFAULT_SETTINGS.thinkingBudgets, ...config.settings?.thinkingBudgets, ...runtimeSettings.thinkingBudgets },
    compaction: { ...DEFAULT_SETTINGS.compaction, ...config.settings?.compaction, ...runtimeSettings.compaction },
    retry: { ...DEFAULT_SETTINGS.retry, ...config.settings?.retry, ...runtimeSettings.retry },
    terminal: { ...DEFAULT_SETTINGS.terminal, ...config.settings?.terminal, ...runtimeSettings.terminal },
    images: { ...DEFAULT_SETTINGS.images, ...config.settings?.images, ...runtimeSettings.images },
    markdown: { ...DEFAULT_SETTINGS.markdown, ...config.settings?.markdown, ...runtimeSettings.markdown },
    disabledTools: [...new Set([...(config.settings?.disabledTools ?? []), ...legacyDisabledTools, ...(runtimeSettings.disabledTools ?? [])])],
  };
  return merged as Settings;
}

export function setRuntimeSettings(overrides: Partial<Settings>): void {
  runtimeSettings = { ...runtimeSettings, ...overrides };
}

export function clearRuntimeSettings(): void {
  runtimeSettings = {};
  runtimeProviderApiKeys.clear();
}

export function updateSetting(key: keyof Settings, value: unknown, scope: "global" | "project" = "global"): void {
  const config = scope === "project" ? loadProjectConfig() : loadGlobalConfig();
  if (!config.settings) config.settings = {};
  (config.settings as Record<string, unknown>)[key] = value;
  if (scope === "project") cachedProject = { cwd: process.cwd(), config };
  else cachedGlobal = config;
  cachedMerged = null;
  saveConfig(config, scope);
}

export function updateSettingsPatch(patch: Partial<Settings>, scope: "global" | "project" = "global"): void {
  const config = scope === "project" ? loadProjectConfig() : loadGlobalConfig();
  config.settings = mergeSettings(config.settings, patch);
  if (scope === "project") cachedProject = { cwd: process.cwd(), config };
  else cachedGlobal = config;
  cachedMerged = null;
  saveConfig(config, scope);
}

const MODEL_PREFERENCE_KEYS: Record<ModelPreferenceSlot, keyof BrokeConfig> = {
  default: "defaultModel",
  small: "defaultSmallModel",
  btw: "defaultBtwModel",
  review: "defaultReviewModel",
  planning: "defaultPlanningModel",
  ui: "defaultUiModel",
  architecture: "defaultArchitectureModel",
};

export function getConfiguredModelPreference(slot: ModelPreferenceSlot): string | undefined {
  const key = MODEL_PREFERENCE_KEYS[slot];
  const value = loadConfig()[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function updateModelPreference(
  slot: ModelPreferenceSlot,
  value: string | null,
  scope: "global" | "project" = "global",
): void {
  const key = MODEL_PREFERENCE_KEYS[slot];
  const config = scope === "project" ? loadProjectConfig() : loadGlobalConfig();
  if (value == null || value.trim().length === 0) delete (config as Record<string, unknown>)[key];
  else (config as Record<string, unknown>)[key] = value.trim();
  if (scope === "project") cachedProject = { cwd: process.cwd(), config };
  else cachedGlobal = config;
  cachedMerged = null;
  saveConfig(config, scope);
}

function saveConfig(config: BrokeConfig, scope: "global" | "project" = "global"): void {
  try {
    const configDir = scope === "project" ? resolve(process.cwd(), ".brokecli") : CONFIG_DIR;
    const configFile = scope === "project" ? getProjectConfigPath() : CONFIG_FILE;
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");
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
  const runtimeApiKey = runtimeProviderApiKeys.get(provider);
  if (runtimeApiKey) return { kind: "api_key", value: runtimeApiKey, source: "runtime" };
  const config = loadConfig();
  const fromConfig = config.providers?.[provider]?.apiKey;
  if (fromConfig) return { kind: "api_key", value: fromConfig, source: "config" };

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

export function getBaseUrl(provider: string): string | undefined {
  const config = loadConfig();
  return config.providers?.[provider]?.baseUrl;
}

export function updateProviderConfig(
  provider: string,
  updates: { apiKey?: string | null; baseUrl?: string | null; disabled?: boolean | null },
  scope: "global" | "project" = "global",
): void {
  const config = scope === "project" ? loadProjectConfig() : loadGlobalConfig();
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
  if (scope === "project") cachedProject = { cwd: process.cwd(), config };
  else cachedGlobal = config;
  cachedMerged = null;
  saveConfig(config, scope);
}

export function getModelContextLimitOverride(provider: string, model: string): number | undefined {
  const config = loadConfig();
  return config.modelContextLimits?.[`${provider}/${model}`] ?? config.modelContextLimits?.[model];
}

export function setRuntimeProviderApiKey(provider: string, apiKey: string | null): void {
  if (!apiKey) runtimeProviderApiKeys.delete(provider);
  else runtimeProviderApiKeys.set(provider, apiKey);
}

export function flushConfig(): void {
  // synchronous writes already flushed
}
