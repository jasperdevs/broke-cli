import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as parseJsonc } from "jsonc-parser";

export type Mode = "build" | "plan";
export type FollowUpMode = "immediate" | "after_tool" | "after_response";
export type ThinkingLevel = "off" | "low" | "medium" | "high";

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
  lastModel: string;
  mode: Mode;
  followUpMode: FollowUpMode;
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
  lastModel: "",
  mode: "build",
  followUpMode: "after_response",
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

  // Check environment variables first
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY || readClaudeToken();
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

function readClaudeToken(): string | undefined {
  try {
    const claudeDir = join(homedir(), ".claude");
    if (!existsSync(claudeDir)) return undefined;
    
    // Check common token file locations
    const tokenFiles = ["credentials.json", "access_token", "api_key", ".claude_api_key"];
    for (const file of tokenFiles) {
      const path = join(claudeDir, file);
      if (existsSync(path)) {
        const content = readFileSync(path, "utf-8").trim();
        if (file.endsWith(".json")) {
          const data = JSON.parse(content);
          return data?.access_token || data?.api_key || data?.token;
        }
        if (content.length > 20 && !content.includes("\n")) {
          return content;
        }
      }
    }
    
    // Check for ANTHROPIC_API_KEY in credentials.json
    const credsPath = join(claudeDir, "credentials.json");
    if (existsSync(credsPath)) {
      const data = JSON.parse(readFileSync(credsPath, "utf-8"));
      return data?.anthropic_api_key || data?.ANTHROPIC_API_KEY;
    }
  } catch {
    // Silently fail
  }
  return undefined;
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
