import { getBaseUrl, getProviderCredential, loadConfig } from "../core/config.js";
import { hasNativeCommand } from "./native-cli.js";

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

/** Probe an arbitrary base URL with a short timeout */
async function probeBaseUrl(baseUrl: string, path = "/models"): Promise<boolean> {
  try {
    const normalized = baseUrl.replace(/\/+$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`${normalized}${path}`, {
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
  const config = loadConfig();
  const providerDisabled = (providerId: string): boolean => !!config.providers?.[providerId]?.disabled;
  const anthropicCredential = getProviderCredential("anthropic");
  const openaiCredential = getProviderCredential("openai");
  const codexCredential = getProviderCredential("codex");
  const googleCredential = getProviderCredential("google");
  const groqCredential = getProviderCredential("groq");
  const mistralCredential = getProviderCredential("mistral");
  const xaiCredential = getProviderCredential("xai");
  const openrouterCredential = getProviderCredential("openrouter");
  const claudeCli = hasNativeCommand("claude");
  const codexCli = hasNativeCommand("codex");

  // Cloud/native providers - only show when a usable auth mode exists
  if (!providerDisabled("anthropic") && anthropicCredential.kind === "api_key") {
    results.push({ id: "anthropic", name: "Anthropic", available: true, reason: "API key" });
  } else if (!providerDisabled("anthropic") && anthropicCredential.kind === "native_oauth" && claudeCli) {
    results.push({ id: "anthropic", name: "Claude Code", available: true, reason: "native login" });
  }
  if (!providerDisabled("openai") && openaiCredential.kind === "api_key") {
    results.push({ id: "openai", name: "OpenAI", available: true, reason: "API key" });
  }
  if (!providerDisabled("codex") && codexCredential.kind === "api_key") {
    results.push({ id: "codex", name: "Codex", available: true, reason: "API key" });
  } else if (!providerDisabled("codex") && codexCredential.kind === "native_oauth" && codexCli) {
    results.push({ id: "codex", name: "Codex", available: true, reason: "native login" });
  }
  if (!providerDisabled("google") && googleCredential.kind === "api_key") {
    results.push({ id: "google", name: "Google", available: true, reason: "API key" });
  }
  if (!providerDisabled("groq") && groqCredential.kind === "api_key") {
    results.push({ id: "groq", name: "Groq", available: true, reason: "API key" });
  }
  if (!providerDisabled("mistral") && mistralCredential.kind === "api_key") {
    results.push({ id: "mistral", name: "Mistral", available: true, reason: "API key" });
  }
  if (!providerDisabled("xai") && xaiCredential.kind === "api_key") {
    results.push({ id: "xai", name: "xAI", available: true, reason: "API key" });
  }
  if (!providerDisabled("openrouter") && openrouterCredential.kind === "api_key") {
    results.push({ id: "openrouter", name: "OpenRouter", available: true, reason: "API key" });
  }

  // Local providers — probe in parallel
  const [ollama, lmStudio, llamaCpp, jan, vllm] = await Promise.all([
    providerDisabled("ollama")
      ? Promise.resolve(false)
      : probeBaseUrl(getBaseUrl("ollama") ?? "http://127.0.0.1:11434/v1", "/models").then((ok) => ok || probeLocal(11434, "/api/tags")),
    providerDisabled("lmstudio")
      ? Promise.resolve(false)
      : probeBaseUrl(getBaseUrl("lmstudio") ?? "http://127.0.0.1:1234/v1"),
    providerDisabled("llamacpp")
      ? Promise.resolve(false)
      : probeBaseUrl(getBaseUrl("llamacpp") ?? "http://127.0.0.1:8080/v1"),
    providerDisabled("jan")
      ? Promise.resolve(false)
      : probeBaseUrl(getBaseUrl("jan") ?? "http://127.0.0.1:1337/v1"),
    providerDisabled("vllm")
      ? Promise.resolve(false)
      : probeBaseUrl(getBaseUrl("vllm") ?? "http://127.0.0.1:8000/v1"),
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
