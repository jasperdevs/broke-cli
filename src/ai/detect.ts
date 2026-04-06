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

/** All known providers */
const ALL_PROVIDERS = [
  { id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
  { id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY" },
  { id: "codex", name: "Codex (OpenAI)", envKey: "" },
  { id: "google", name: "Google", envKey: "GOOGLE_API_KEY" },
  { id: "groq", name: "Groq", envKey: "GROQ_API_KEY" },
  { id: "mistral", name: "Mistral", envKey: "MISTRAL_API_KEY" },
  { id: "xai", name: "xAI", envKey: "XAI_API_KEY" },
  { id: "openrouter", name: "OpenRouter", envKey: "OPENROUTER_API_KEY" },
];

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

  // Add all known cloud providers (available if they have credentials)
  for (const p of ALL_PROVIDERS) {
    const key = getApiKey(p.id);
    if (key) {
      results.push({ id: p.id, name: p.name, available: true, reason: p.envKey || "auth" });
    } else {
      // Show unavailable providers too so user can select and authenticate
      results.push({ id: p.id, name: p.name, available: false, reason: `Set ${p.envKey || "credentials"}` });
    }
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
  else results.push({ id: "ollama", name: "Ollama", available: false, reason: "Start Ollama" });
  
  if (lmStudio) results.push({ id: "lmstudio", name: "LM Studio", available: true, reason: "localhost:1234" });
  else results.push({ id: "lmstudio", name: "LM Studio", available: false, reason: "Start LM Studio" });
  
  if (llamaCpp) results.push({ id: "llamacpp", name: "llama.cpp", available: true, reason: "localhost:8080" });
  else results.push({ id: "llamacpp", name: "llama.cpp", available: false, reason: "Start llama.cpp" });
  
  if (jan) results.push({ id: "jan", name: "Jan", available: true, reason: "localhost:1337" });
  else results.push({ id: "jan", name: "Jan", available: false, reason: "Start Jan" });
  
  if (vllm) results.push({ id: "vllm", name: "vLLM", available: true, reason: "localhost:8000" });
  else results.push({ id: "vllm", name: "vLLM", available: false, reason: "Start vLLM" });

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
  // If nothing available, return first provider (user can authenticate)
  return providers[0];
}
