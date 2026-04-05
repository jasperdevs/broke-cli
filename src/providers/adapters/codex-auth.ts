import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";

const CODEX_AUTH_FILE = join(homedir(), ".codex", "auth.json");

interface CodexAuth {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

/**
 * Try to load existing Codex OAuth tokens from ~/.codex/auth.json.
 * Returns null if Codex CLI is not installed or not authenticated.
 */
export function loadCodexAuth(): CodexAuth | null {
  if (!existsSync(CODEX_AUTH_FILE)) return null;

  try {
    const content = readFileSync(CODEX_AUTH_FILE, "utf-8");
    const auth = JSON.parse(content) as CodexAuth;

    if (!auth.access_token) return null;

    // Check if expired (with 5min buffer)
    if (auth.expires_at && Date.now() / 1000 > auth.expires_at - 300) {
      // Token expired — user needs to run `codex auth login` again
      return null;
    }

    return auth;
  } catch {
    return null;
  }
}

/**
 * Create an AI SDK OpenAI provider using Codex OAuth tokens.
 * Routes through the subscription backend, not API credits.
 */
export function createCodexProvider(auth: CodexAuth): {
  languageModel(modelId: string): LanguageModelV3;
} {
  const sdk = createOpenAI({
    apiKey: auth.access_token,
    // Codex OAuth uses the same OpenAI API endpoint
    // but authenticates via subscription, not API credits
  });

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
