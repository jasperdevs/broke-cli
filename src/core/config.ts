import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { parse as parseJsonc } from "jsonc-parser";
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
  AutonomySettings,
  Settings,
  BrokeConfig,
  ProviderCredentialKind,
  ProviderCredential,
} from "./config-types.js";
export { DEFAULT_SETTINGS } from "./config-defaults.js";
import { DEFAULT_SETTINGS } from "./config-defaults.js";
import type { BrokeConfig, ModelPreferenceSlot, Settings } from "./config-types.js";
import { clearRuntimeProviderApiKeys } from "./provider-runtime-overrides.js";

const CONFIG_DIR = join(homedir(), ".brokecli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

let cachedGlobal: BrokeConfig | null = null;
let cachedProject: { cwd: string; config: BrokeConfig } | null = null;
let cachedMerged: BrokeConfig | null = null;
let runtimeSettings: Partial<Settings> = {};

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
    autonomy: { ...(base?.autonomy ?? {}), ...(override?.autonomy ?? {}) },
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
    autonomy: { ...DEFAULT_SETTINGS.autonomy, ...config.settings?.autonomy, ...runtimeSettings.autonomy },
    disabledTools: [...new Set([...(config.settings?.disabledTools ?? []), ...legacyDisabledTools, ...(runtimeSettings.disabledTools ?? [])])],
  };
  return merged as Settings;
}

export function setRuntimeSettings(overrides: Partial<Settings>): void {
  runtimeSettings = { ...runtimeSettings, ...overrides };
}

export function clearRuntimeSettings(): void {
  runtimeSettings = {};
  clearRuntimeProviderApiKeys();
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

export function flushConfig(): void {
  // synchronous writes already flushed
}
