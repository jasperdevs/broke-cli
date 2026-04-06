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

  // Cloud providers - only show if API key exists
  if (getApiKey("anthropic")) {
    results.push({ id: "anthropic", name: "Anthropic", available: true, reason: "API key" });
  }
  if (getApiKey("openai")) {
    results.push({ id: "openai", name: "OpenAI", available: true, reason: "API key" });
  }
  if (getApiKey("codex")) {
    results.push({ id: "codex", name: "Codex", available: true, reason: "OAuth" });
  }
  if (getApiKey("google")) {
    results.push({ id: "google", name: "Google", available: true, reason: "API key" });
  }
  if (getApiKey("groq")) {
    results.push({ id: "groq", name: "Groq", available: true, reason: "API key" });
  }
  if (getApiKey("mistral")) {
    results.push({ id: "mistral", name: "Mistral", available: true, reason: "API key" });
  }
  if (getApiKey("xai")) {
    results.push({ id: "xai", name: "xAI", available: true, reason: "API key" });
  }
  if (getApiKey("openrouter")) {
    results.push({ id: "openrouter", name: "OpenRouter", available: true, reason: "API key" });
  }

  // Local providers — probe in parallel
  const [ollama, lmStudio, llamaCpp, jan, vllm] = await Promise.all([
    probeLocal(11434, "/api/tags"),
    probeLocal(1234, "/v1/models"),
    probeLocal(8080, "/v1/models"),
    probeLocal(1337, "/v1/models"),
    probeLocal(8000, "/v1/models"),
  ]);

  if (ollama) results.push({ id: "ollama", name: "Ollama", available: true, reason: "running" });
  if (lmStudio) results.push({ id: "lmstudio", name: "LM Studio", available: true, reason: "running" });
  if (llamaCpp) results.push({ id: "llamacpp", name: "llama.cpp", available: true, reason: "running" });
  if (jan) results.push({ id: "jan", name: "Jan", available: true, reason: "running" });
  if (vllm) results.push({ id: "vllm", name: "vLLM", available: true, reason: "running" });

  return results;
}

/** Pick the best default provider from detected ones */
export function pickDefault(providers: DetectedProvider[]): DetectedProvider | undefined {
  // Prefer cloud providers that are available, then local
  const priority = ["anthropic", "openai", "codex", "google", "groq", "mistral", "xai", "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm"];
  for (const id of priority) {
    const p = providers.find((x) => x.id === id && x.available);
    if (p) return p;
  }
  return undefined;
}
