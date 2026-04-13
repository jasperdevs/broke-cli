import { getBaseUrl, loadConfig } from "../core/config.js";
import { getProviderCredential } from "../core/provider-credentials.js";
import { hasNativeCommand } from "./native-cli.js";
import {
  getModelPricing,
  getProviderDefaultModelId,
  getProviderNativeDefaultModelId,
  getProviderNativePreferredDisplayModelIds,
  getProviderNativeSmallModelId,
  getProviderPreferredDisplayModelIds,
  getProviderSmallModelId,
  getModelSpec,
} from "./model-catalog.js";
import { getProviderInfo, LOCAL_PROVIDER_IDS } from "./provider-definitions.js";

export interface DetectedProvider {
  id: string;
  name: string;
  available: boolean;
  reason: string;
}

export interface CheapestDetectedModel {
  providerId: string;
  modelId: string;
}

function listBudgetCandidateModelIds(provider: DetectedProvider): string[] {
  const ordered = provider.reason === "native login"
    ? [
      getProviderNativeSmallModelId(provider.id),
      getProviderNativeDefaultModelId(provider.id),
      ...getProviderNativePreferredDisplayModelIds(provider.id),
    ]
    : [
      getProviderSmallModelId(provider.id),
      getProviderDefaultModelId(provider.id),
      getProviderInfo(provider.id)?.defaultModel,
      ...(getProviderInfo(provider.id)?.models ?? []),
      ...getProviderPreferredDisplayModelIds(provider.id),
    ];
  const filtered = ordered.filter((modelId): modelId is string => !!modelId);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const modelId of filtered) {
    if (seen.has(modelId)) continue;
    seen.add(modelId);
    deduped.push(modelId);
  }
  return deduped;
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

async function probeAny(baseUrl: string, paths: string[]): Promise<boolean> {
  for (const path of paths) {
    if (await probeBaseUrl(baseUrl, path)) return true;
  }
  return false;
}

export async function detectProviders(): Promise<DetectedProvider[]> {
  const results: DetectedProvider[] = [];
  const config = loadConfig();
  const providerDisabled = (providerId: string): boolean => !!config.providers?.[providerId]?.disabled;
  const anthropicCredential = getProviderCredential("anthropic");
  const openaiCredential = getProviderCredential("openai");
  const codexCredential = getProviderCredential("codex");
  const githubCopilotCredential = getProviderCredential("github-copilot");
  const googleGeminiCliCredential = getProviderCredential("google-gemini-cli");
  const googleAntigravityCredential = getProviderCredential("google-antigravity");
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
  if (!providerDisabled("github-copilot") && githubCopilotCredential.kind === "native_oauth") {
    results.push({ id: "github-copilot", name: "GitHub Copilot", available: true, reason: "OAuth login" });
  }
  if (!providerDisabled("google") && googleCredential.kind === "api_key") {
    results.push({ id: "google", name: "Google", available: true, reason: "API key" });
  }
  if (!providerDisabled("google-gemini-cli") && googleGeminiCliCredential.kind === "native_oauth") {
    results.push({ id: "google-gemini-cli", name: "Google Cloud Code Assist", available: true, reason: "OAuth login" });
  }
  if (!providerDisabled("google-antigravity") && googleAntigravityCredential.kind === "native_oauth") {
    results.push({ id: "google-antigravity", name: "Antigravity", available: true, reason: "OAuth login" });
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
      : probeAny(getBaseUrl("lmstudio") ?? "http://127.0.0.1:1234/v1", ["/models", "/lmstudio/models"]),
    providerDisabled("llamacpp")
      ? Promise.resolve(false)
      : probeAny(getBaseUrl("llamacpp") ?? "http://127.0.0.1:8080/v1", ["/models"]).then((ok) => ok || probeAny((getBaseUrl("llamacpp") ?? "http://127.0.0.1:8080/v1").replace(/\/v1\/?$/, ""), ["/models", "/slots"])),
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
  const priority = ["anthropic", "github-copilot", "google-gemini-cli", "google-antigravity", "openai", "codex", "google", "groq", "mistral", "xai", "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm"];
  for (const id of priority) {
    const p = providers.find((x) => x.id === id && x.available);
    if (p) return p;
  }
  return undefined;
}

export function pickCheapestDetectedModel(providers: DetectedProvider[]): CheapestDetectedModel | null {
  const candidates = providers
    .filter((provider) => provider.available)
    .flatMap((provider, providerIndex) =>
      listBudgetCandidateModelIds(provider).map((modelId, priorityIndex) => {
        const pricing = getModelPricing(modelId, provider.id);
        const hasCatalogPricing = !!getModelSpec(modelId, provider.id)?.cost;
        const isLocal = LOCAL_PROVIDER_IDS.has(provider.id);
        const priced = isLocal || hasCatalogPricing;
        return {
          providerId: provider.id,
          modelId,
          input: priced ? pricing.input : 0,
          output: priced ? pricing.output : 0,
          priced,
          isLocal,
          providerIndex,
          priorityIndex,
        };
      }),
    );

  if (candidates.length === 0) return null;

  candidates.sort((left, right) =>
    Number(right.priced) - Number(left.priced)
    || Number(right.isLocal) - Number(left.isLocal)
    || (left.input + left.output) - (right.input + right.output)
    || left.input - right.input
    || left.output - right.output
    || left.providerIndex - right.providerIndex
    || left.priorityIndex - right.priorityIndex
    || left.providerId.localeCompare(right.providerId)
    || left.modelId.localeCompare(right.modelId));

  const cheapest = candidates[0]!;
  return { providerId: cheapest.providerId, modelId: cheapest.modelId };
}
