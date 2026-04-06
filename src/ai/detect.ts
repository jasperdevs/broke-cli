import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getApiKey } from "../core/config.js";

export interface DetectedProvider {
  id: string;
  name: string;
  available: boolean;
  reason: string;
}

/** Probe a local HTTP server with a short timeout */
async function probeLocal(port: number, path = "/"): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

export async function detectProviders(): Promise<DetectedProvider[]> {
  const results: DetectedProvider[] = [];

  // Anthropic — env var
  if (getApiKey("anthropic")) {
    results.push({ id: "anthropic", name: "Anthropic", available: true, reason: "ANTHROPIC_API_KEY" });
  }

  // OpenAI — env var
  if (getApiKey("openai")) {
    results.push({ id: "openai", name: "OpenAI", available: true, reason: "OPENAI_API_KEY" });
  }

  // Codex OAuth — auth file
  if (getApiKey("codex")) {
    results.push({ id: "codex", name: "Codex (OpenAI)", available: true, reason: "~/.codex/auth.json" });
  }

  // Google Gemini
  if (getApiKey("google")) {
    results.push({ id: "google", name: "Google", available: true, reason: "GOOGLE_API_KEY" });
  }

  // Groq
  if (getApiKey("groq")) {
    results.push({ id: "groq", name: "Groq", available: true, reason: "GROQ_API_KEY" });
  }

  // Mistral
  if (getApiKey("mistral")) {
    results.push({ id: "mistral", name: "Mistral", available: true, reason: "MISTRAL_API_KEY" });
  }

  // xAI
  if (getApiKey("xai")) {
    results.push({ id: "xai", name: "xAI", available: true, reason: "XAI_API_KEY" });
  }

  // OpenRouter
  if (getApiKey("openrouter")) {
    results.push({ id: "openrouter", name: "OpenRouter", available: true, reason: "OPENROUTER_API_KEY" });
  }

  // Local providers — probe in parallel
  const [ollama, lmStudio, llamaCpp, jan, vllm] = await Promise.all([
    probeLocal(11434, "/api/tags"),
    probeLocal(1234, "/v1/models"),
    probeLocal(8080, "/v1/models"),
    probeLocal(1337, "/v1/models"),
    probeLocal(8000, "/v1/models"),
  ]);

  if (ollama) results.push({ id: "ollama", name: "Ollama", available: true, reason: "localhost:11434" });
  if (lmStudio) results.push({ id: "lmstudio", name: "LM Studio", available: true, reason: "localhost:1234" });
  if (llamaCpp) results.push({ id: "llamacpp", name: "llama.cpp", available: true, reason: "localhost:8080" });
  if (jan) results.push({ id: "jan", name: "Jan", available: true, reason: "localhost:1337" });
  if (vllm) results.push({ id: "vllm", name: "vLLM", available: true, reason: "localhost:8000" });

  return results;
}

/** Pick the best default provider from detected ones */
export function pickDefault(providers: DetectedProvider[]): DetectedProvider | undefined {
  // Prefer cloud providers (more capable), then local
  const priority = ["anthropic", "openai", "codex", "ollama", "lmstudio", "llamacpp", "jan", "vllm"];
  for (const id of priority) {
    const p = providers.find((x) => x.id === id && x.available);
    if (p) return p;
  }
  return undefined;
}
