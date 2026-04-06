import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
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

export function saveCredentials(provider: string, token: string): void {
  const data = readAuthData();
  data[provider] = { provider, token };
  writeAuthData(data);
}

export function getCredentials(provider: string): string | null {
  const data = readAuthData();
  const entry = data[provider];
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) return null;
  return entry.token;
}

export function clearCredentials(provider: string): void {
  const data = readAuthData();
  delete data[provider];
  writeAuthData(data);
}

export function listAuthenticated(): string[] {
  const data = readAuthData();
  return Object.keys(data).filter((p) => {
    const entry = data[p];
    if (entry.expiresAt && Date.now() > entry.expiresAt) return false;
    return true;
  });
}
