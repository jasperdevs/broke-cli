import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as parseJsonc } from "jsonc-parser";

export type Mode = "build" | "plan";

export interface Settings {
  yoloMode: boolean;
  autoCompact: boolean;
  maxSessionCost: number;
  theme: string;
  showTokens: boolean;
  showCost: boolean;
  autoSaveSessions: boolean;
  enableThinking: boolean;
  gitCheckpoints: boolean;
  scopedModels: string[];
  mode: Mode;
}

export const DEFAULT_SETTINGS: Settings = {
  yoloMode: true,
  autoCompact: true,
  maxSessionCost: 0,
  theme: "dark",
  showTokens: true,
  showCost: true,
  autoSaveSessions: true,
  enableThinking: false,
  gitCheckpoints: true,
  scopedModels: [],
  mode: "build",
};

export interface BrokeConfig {
  defaultProvider?: string;
  defaultModel?: string;
  budget?: { maxSessionCost?: number; maxMonthlyCost?: number };
  providers?: Record<string, { apiKey?: string; baseUrl?: string }>;
  settings?: Partial<Settings>;
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

export function getApiKey(provider: string): string | undefined {
  const config = loadConfig();
  const fromConfig = config.providers?.[provider]?.apiKey;
  if (fromConfig) return fromConfig;

  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "codex":
      return readCodexToken();
    case "google":
      return process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    case "groq":
      return process.env.GROQ_API_KEY;
    case "mistral":
      return process.env.MISTRAL_API_KEY;
    case "xai":
      return process.env.XAI_API_KEY;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY;
    default:
      return undefined;
  }
}

function readCodexToken(): string | undefined {
  try {
    const authFile = join(homedir(), ".codex", "auth.json");
    if (!existsSync(authFile)) return undefined;
    const data = JSON.parse(readFileSync(authFile, "utf-8"));
    return data?.tokens?.access_token ?? data?.OPENAI_API_KEY;
  } catch {
    return undefined;
  }
}

export function getBaseUrl(provider: string): string | undefined {
  const config = loadConfig();
  return config.providers?.[provider]?.baseUrl;
}
