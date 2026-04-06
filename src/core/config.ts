import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { parse as parseJsonc } from "jsonc-parser";

export type Mode = "build" | "plan";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type CavemanLevel = "off" | "lite" | "auto" | "ultra";
export type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";
export type QueueDeliveryMode = "one-at-a-time" | "all";
export type TransportMode = "auto" | "sse" | "websocket";

export interface PackageFilterSource {
  source: string;
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

export type PackageSource = string | PackageFilterSource;

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface BranchSummarySettings {
  reserveTokens: number;
  skipPrompt: boolean;
}

export interface RetrySettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface TerminalSettings {
  showImages: boolean;
  clearOnShrink: boolean;
}

export interface ImageSettings {
  autoResize: boolean;
  blockImages: boolean;
}

export interface MarkdownSettings {
  codeBlockIndent: string;
}

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
  cavemanLevel: CavemanLevel;
  theme: string;
  autoLint: boolean;
  autoTest: boolean;
  autoFixValidation: boolean;
  lintCommand: string;
  testCommand: string;
  deniedTools: string[];
  disabledExtensions: string[];
  quietStartup: boolean;
  collapseChangelog: boolean;
  doubleEscapeAction: "tree" | "fork" | "none";
  treeFilterMode: TreeFilterMode;
  editorPaddingX: number;
  autocompleteMaxVisible: number;
  showHardwareCursor: boolean;
  sessionDir: string;
  defaultThinkingLevel: ThinkingLevel;
  hideThinkingBlock: boolean;
  thinkingBudgets: Partial<Record<Exclude<ThinkingLevel, "off">, number>>;
  compaction: CompactionSettings;
  branchSummary: BranchSummarySettings;
  retry: RetrySettings;
  steeringMode: QueueDeliveryMode;
  followUpMode: QueueDeliveryMode;
  transport: TransportMode;
  terminal: TerminalSettings;
  images: ImageSettings;
  shellPath: string;
  shellCommandPrefix: string;
  npmCommand: string[];
  enabledModels: string[];
  markdown: MarkdownSettings;
  packages: PackageSource[];
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
  enableSkillCommands: boolean;
  verboseStartup: boolean;
  discoverExtensions: boolean;
  discoverSkills: boolean;
  discoverPrompts: boolean;
  discoverThemes: boolean;
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
  cavemanLevel: "off",
  theme: "brokecli-dark",
  autoLint: false,
  autoTest: false,
  autoFixValidation: false,
  lintCommand: "npm run lint",
  testCommand: "npm test",
  deniedTools: [],
  disabledExtensions: [],
  quietStartup: false,
  collapseChangelog: false,
  doubleEscapeAction: "tree",
  treeFilterMode: "default",
  editorPaddingX: 0,
  autocompleteMaxVisible: 5,
  showHardwareCursor: false,
  sessionDir: "",
  defaultThinkingLevel: "off",
  hideThinkingBlock: false,
  thinkingBudgets: {
    minimal: 1024,
    low: 4096,
    medium: 10240,
    high: 32768,
    xhigh: 65536,
  },
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
  branchSummary: {
    reserveTokens: 16384,
    skipPrompt: false,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
  },
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  transport: "auto",
  terminal: {
    showImages: true,
    clearOnShrink: false,
  },
  images: {
    autoResize: true,
    blockImages: false,
  },
  shellPath: "",
  shellCommandPrefix: "",
  npmCommand: [],
  enabledModels: [],
  markdown: {
    codeBlockIndent: "  ",
  },
  packages: [],
  extensions: [],
  skills: [],
  prompts: [],
  themes: [],
  enableSkillCommands: true,
  verboseStartup: false,
  discoverExtensions: true,
  discoverSkills: true,
  discoverPrompts: true,
  discoverThemes: true,
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
    branchSummary: { ...(base?.branchSummary ?? {}), ...(override?.branchSummary ?? {}) },
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
  const merged = {
    ...DEFAULT_SETTINGS,
    ...mergeSettings(DEFAULT_SETTINGS, config.settings),
    ...runtimeSettings,
    thinkingBudgets: { ...DEFAULT_SETTINGS.thinkingBudgets, ...config.settings?.thinkingBudgets, ...runtimeSettings.thinkingBudgets },
    compaction: { ...DEFAULT_SETTINGS.compaction, ...config.settings?.compaction, ...runtimeSettings.compaction },
    branchSummary: { ...DEFAULT_SETTINGS.branchSummary, ...config.settings?.branchSummary, ...runtimeSettings.branchSummary },
    retry: { ...DEFAULT_SETTINGS.retry, ...config.settings?.retry, ...runtimeSettings.retry },
    terminal: { ...DEFAULT_SETTINGS.terminal, ...config.settings?.terminal, ...runtimeSettings.terminal },
    images: { ...DEFAULT_SETTINGS.images, ...config.settings?.images, ...runtimeSettings.images },
    markdown: { ...DEFAULT_SETTINGS.markdown, ...config.settings?.markdown, ...runtimeSettings.markdown },
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

export function getProviderCredential(provider: string): ProviderCredential {
  const runtimeApiKey = runtimeProviderApiKeys.get(provider);
  if (runtimeApiKey) return { kind: "api_key", value: runtimeApiKey, source: "runtime" };
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
