import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { loadCodexAuth } from "./adapters/codex-auth.js";

export interface DetectionResult {
  id: string;
  name: string;
  method: "env" | "config" | "oauth" | "local";
  apiKey?: string;
  baseUrl?: string;
}

/** Check if a binary exists in PATH */
function hasBinary(name: string): boolean {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Probe a local HTTP endpoint with a short timeout */
async function probeEndpoint(url: string, timeoutMs = 500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Detect all available providers from env, auth files, and local servers */
export async function detectAllProviders(
  configProviders: Record<string, { apiKey?: string; baseUrl?: string; enabled?: boolean }>,
): Promise<DetectionResult[]> {
  const results: DetectionResult[] = [];
  const env = process.env;

  // --- API key providers (env + config) ---
  const keyProviders = [
    { id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
    { id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY" },
    { id: "google", name: "Google", envKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
    { id: "openrouter", name: "OpenRouter", envKey: "OPENROUTER_API_KEY" },
    { id: "groq", name: "Groq", envKey: "GROQ_API_KEY" },
    { id: "together", name: "Together", envKey: "TOGETHER_AI_API_KEY" },
    { id: "mistral", name: "Mistral", envKey: "MISTRAL_API_KEY" },
    { id: "xai", name: "xAI", envKey: "XAI_API_KEY" },
  ];

  for (const kp of keyProviders) {
    const configEntry = configProviders[kp.id];
    const apiKey = configEntry?.apiKey ?? env[kp.envKey];
    const enabled = configEntry?.enabled !== false;

    if (apiKey && enabled) {
      results.push({
        id: kp.id,
        name: kp.name,
        method: configEntry?.apiKey ? "config" : "env",
        apiKey,
        baseUrl: configEntry?.baseUrl,
      });
    }
  }

  // --- Codex CLI binary detection ---
  if (!results.some((r) => r.id === "openai") && hasBinary("codex")) {
    // Codex binary exists but no auth yet — hint to user
    const codexAuth = loadCodexAuth();
    if (!codexAuth) {
      results.push({
        id: "codex",
        name: "Codex CLI (installed, run codex auth login)",
        method: "oauth",
        apiKey: undefined,
      });
    }
  }

  // --- Codex OAuth (ChatGPT subscription) ---
  if (!results.some((r) => r.id === "openai")) {
    const codexAuth = loadCodexAuth();
    if (codexAuth) {
      results.push({
        id: "openai",
        name: "OpenAI (Codex)",
        method: "oauth",
        apiKey: codexAuth.accessToken,
      });
    }
  }

  // --- Local model servers (probe in parallel) ---
  const localProbes = [
    { id: "ollama", name: "Ollama", url: "http://localhost:11434/api/tags", baseUrl: "http://localhost:11434/v1", binary: "ollama" },
    { id: "lmstudio", name: "LM Studio", url: "http://localhost:1234/v1/models", baseUrl: "http://localhost:1234/v1", binary: null },
    { id: "llamacpp", name: "llama.cpp", url: "http://localhost:8080/v1/models", baseUrl: "http://localhost:8080/v1", binary: null },
    { id: "jan", name: "Jan", url: "http://localhost:1337/v1/models", baseUrl: "http://localhost:1337/v1", binary: null },
    { id: "vllm", name: "vLLM", url: "http://localhost:8000/v1/models", baseUrl: "http://localhost:8000/v1", binary: null },
  ];

  const probeResults = await Promise.allSettled(
    localProbes.map(async (lp) => {
      const serverRunning = await probeEndpoint(lp.url);
      if (serverRunning) {
        return { id: lp.id, name: `${lp.name} (running)`, method: "local" as const, baseUrl: lp.baseUrl, apiKey: "local" };
      }
      // Even if server isn't running, check if binary is installed
      if (lp.binary && hasBinary(lp.binary)) {
        return { id: lp.id, name: `${lp.name} (installed, not running)`, method: "local" as const, baseUrl: lp.baseUrl, apiKey: undefined };
      }
      return null;
    }),
  );

  for (const pr of probeResults) {
    if (pr.status === "fulfilled" && pr.value) {
      results.push(pr.value);
    }
  }

  return results;
}

/** Get a summary line for each detected provider */
export function formatDetection(d: DetectionResult): string {
  switch (d.method) {
    case "env":
      return `${d.name} (env var)`;
    case "config":
      return `${d.name} (config file)`;
    case "oauth":
      return `${d.name} (subscription)`;
    case "local":
      return `${d.name} (local)`;
  }
}
