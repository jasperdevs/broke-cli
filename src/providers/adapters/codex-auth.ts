import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";

const CODEX_AUTH_FILE = join(homedir(), ".codex", "auth.json");

/** Actual structure of ~/.codex/auth.json */
interface CodexAuthFile {
  auth_mode: "chatgpt" | "api-key";
  OPENAI_API_KEY: string | null;
  tokens: {
    id_token: string;
    access_token: string;
    refresh_token: string;
    account_id: string;
  };
  last_refresh: string;
}

/** Simplified auth result */
export interface CodexAuth {
  accessToken: string;
  mode: "chatgpt" | "api-key";
}

/**
 * Load Codex OAuth tokens from ~/.codex/auth.json.
 * Returns null if Codex CLI is not installed or not authenticated.
 */
export function loadCodexAuth(): CodexAuth | null {
  if (!existsSync(CODEX_AUTH_FILE)) return null;

  try {
    const content = readFileSync(CODEX_AUTH_FILE, "utf-8");
    const file = JSON.parse(content) as CodexAuthFile;

    // Check for API key mode first
    if (file.OPENAI_API_KEY) {
      return { accessToken: file.OPENAI_API_KEY, mode: "api-key" };
    }

    // Check for OAuth tokens
    if (!file.tokens?.access_token) return null;

    // Check JWT expiry (decode payload without verification)
    try {
      const payload = JSON.parse(
        Buffer.from(file.tokens.access_token.split(".")[1], "base64").toString(),
      );
      if (payload.exp && Date.now() / 1000 > payload.exp - 300) {
        return null; // expired
      }
    } catch {
      // If we can't decode the JWT, still try to use it
    }

    return { accessToken: file.tokens.access_token, mode: file.auth_mode };
  } catch {
    return null;
  }
}

/**
 * Create an AI SDK OpenAI provider using Codex OAuth tokens.
 */
export function createCodexProvider(auth: CodexAuth): {
  languageModel(modelId: string): LanguageModelV3;
} {
  const sdk = createOpenAI({ apiKey: auth.accessToken });
  return {
    languageModel: (id: string) => sdk(id) as unknown as LanguageModelV3,
  };
}

/**
 * Check if Codex CLI is installed and authenticated.
 */
export function isCodexAvailable(): boolean {
  return loadCodexAuth() !== null;
}
