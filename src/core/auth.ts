import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface AuthCredentials {
  provider: string;
  token: string;
  expiresAt?: number;
}

const CONFIG_DIR = join(homedir(), ".brokecli");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");

function readAuthData(): Record<string, AuthCredentials> {
  if (!existsSync(AUTH_FILE)) return {};
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeAuthData(data: Record<string, AuthCredentials>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function saveCredentials(provider: string, token: string, expiresAt?: number): void {
  const data = readAuthData();
  data[provider] = { provider, token, expiresAt };
  writeAuthData(data);
}

export function getCredentials(provider: string): string | null {
  // First check our own storage
  const data = readAuthData();
  const entry = data[provider];
  if (entry?.token) {
    if (entry.expiresAt && Date.now() > entry.expiresAt) return null;
    return entry.token;
  }

  // Then check official CLI locations
  if (provider === "codex") return getCodexToken();
  if (provider === "anthropic") return getClaudeToken();

  return null;
}

export function clearCredentials(provider: string): void {
  const data = readAuthData();
  delete data[provider];
  writeAuthData(data);
}

export function hasStoredCredentials(provider: string): boolean {
  const data = readAuthData();
  const entry = data[provider];
  if (!entry?.token) return false;
  if (entry.expiresAt && Date.now() > entry.expiresAt) return false;
  return true;
}

export function listAuthenticated(): string[] {
  const data = readAuthData();
  const authed = Object.keys(data).filter((p) => {
    const entry = data[p];
    if (entry.expiresAt && Date.now() > entry.expiresAt) return false;
    return true;
  });

  // Also check official CLI tokens
  if (getCodexToken() && !authed.includes("codex")) authed.push("codex");
  if (getClaudeToken() && !authed.includes("anthropic")) authed.push("anthropic");

  return authed;
}

/** Read Codex CLI auth token from ~/.codex/auth.json */
function getCodexToken(): string | null {
  const codexAuthPath = join(homedir(), ".codex", "auth.json");
  if (!existsSync(codexAuthPath)) return null;
  try {
    const data = JSON.parse(readFileSync(codexAuthPath, "utf-8"));
    // Codex stores as { tokens: { access_token: "..." } } or { OPENAI_API_KEY: "..." }
    return data?.tokens?.access_token || data?.OPENAI_API_KEY || null;
  } catch {
    return null;
  }
}

/** Read Claude Code auth token from ~/.claude/ */
function getClaudeToken(): string | null {
  const claudeDir = join(homedir(), ".claude");
  if (!existsSync(claudeDir)) return null;

  // Claude Code stores tokens in various files - check common locations
  const tokenFiles = [
    "credentials.json",
    "access_token",
    "api_key",
    ".claude_api_key",
  ];

  for (const file of tokenFiles) {
    const path = join(claudeDir, file);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8").trim();
        if (file.endsWith(".json")) {
          const data = JSON.parse(content);
          return data?.access_token || data?.api_key || data?.token || null;
        }
        // Plain text token
        if (content.length > 20 && !content.includes("\n")) {
          return content;
        }
      } catch {
        continue;
      }
    }
  }

  // Check for ANTHROPIC_API_KEY in credentials
  const credsPath = join(claudeDir, "credentials.json");
  if (existsSync(credsPath)) {
    try {
      const data = JSON.parse(readFileSync(credsPath, "utf-8"));
      return data?.anthropic_api_key || data?.ANTHROPIC_API_KEY || null;
    } catch {
      return null;
    }
  }

  return null;
}
