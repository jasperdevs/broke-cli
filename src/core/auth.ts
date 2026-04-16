import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { writePrivateTextFile } from "./private-files.js";

export interface AuthCredentials {
  provider: string;
  token: string;
  expiresAt?: number;
}

const CONFIG_DIR = join(homedir(), ".brokecli");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");
let cachedAuthData: Record<string, AuthCredentials> | null = null;

function readAuthData(): Record<string, AuthCredentials> {
  if (cachedAuthData) return { ...cachedAuthData };
  if (!existsSync(AUTH_FILE)) return {};
  try {
    cachedAuthData = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
    return { ...cachedAuthData };
  } catch {
    return {};
  }
}

function writeAuthData(data: Record<string, AuthCredentials>): void {
  cachedAuthData = { ...data };
  writePrivateTextFile(AUTH_FILE, JSON.stringify(data, null, 2));
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

export function resetAuthCacheForTests(): void {
  cachedAuthData = null;
}

export function parseCodexCliAuthToken(data: unknown): string | null {
  const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const authMode = typeof record.auth_mode === "string" ? record.auth_mode.toLowerCase() : "";
  const tokens = typeof record.tokens === "object" && record.tokens !== null ? record.tokens as Record<string, unknown> : null;
  const accessToken = tokens?.access_token;
  if ((authMode.includes("chatgpt") || authMode.includes("oauth") || tokens) && typeof accessToken === "string" && accessToken.trim().length > 20) {
    return accessToken.trim();
  }
  return null;
}

export function parseClaudeCliAuthToken(data: unknown): string | null {
  const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const oauth = record.claudeAiOauth;
  if (typeof oauth === "object" && oauth !== null) {
    const accessToken = (oauth as Record<string, unknown>).accessToken;
    if (typeof accessToken === "string" && accessToken.trim().length > 20) {
      return accessToken.trim();
    }
  }
  return null;
}

/** Read Codex CLI OAuth token from ~/.codex/auth.json */
function getCodexToken(): string | null {
  const codexAuthPath = join(homedir(), ".codex", "auth.json");
  if (!existsSync(codexAuthPath)) return null;
  try {
    return parseCodexCliAuthToken(JSON.parse(readFileSync(codexAuthPath, "utf-8")));
  } catch {
    return null;
  }
}

/** Read Claude Code OAuth token from ~/.claude/ */
function getClaudeToken(): string | null {
  const claudeDir = join(homedir(), ".claude");
  if (!existsSync(claudeDir)) return null;
  for (const file of [".credentials.json", "credentials.json"]) {
    const path = join(claudeDir, file);
    if (!existsSync(path)) continue;
    try {
      const token = parseClaudeCliAuthToken(JSON.parse(readFileSync(path, "utf-8")));
      if (token) return token;
    } catch {
      continue;
    }
  }
  return null;
}
