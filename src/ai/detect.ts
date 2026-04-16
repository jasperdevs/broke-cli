import { loadConfig } from "../core/config.js";
import {
  getConfiguredProviderApi,
  getConfiguredProviderApiKey,
  getConfiguredProviderBaseUrl,
  getConfiguredProviderModels,
  getConfiguredProviderName,
  listConfiguredProviderIds,
} from "../core/models-config.js";
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
import { isProviderRuntimeSelectable } from "./provider-runtime.js";

export interface DetectedProvider {
  id: string;
  name: string;
  available: boolean;
  reason: string;
}

const BUILTIN_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "codex",
  "github-copilot",
  "google",
  "google-gemini-cli",
  "google-antigravity",
  "groq",
  "mistral",
  "xai",
  "openrouter",
  "ollama",
  "lmstudio",
  "llamacpp",
  "jan",
  "vllm",
] as const;

export interface CheapestDetectedModel {
  providerId: string;
  modelId: string;
}

function isSelectableDetectedProvider(provider: DetectedProvider): boolean {
  if (LOCAL_PROVIDER_IDS.has(provider.id)) return true;
  if ((provider.id === "anthropic" || provider.id === "codex") && provider.reason === "native login") return true;
  if (provider.id === "github-copilot" && provider.reason === "OAuth login") return true;
  return isProviderRuntimeSelectable(provider.id);
}

function tokenEfficiencyScore(providerId: string, modelId: string): number {
  const spec = getModelSpec(modelId, providerId);
  const normalized = modelId.toLowerCase();
  const family = spec?.family?.toLowerCase() ?? "";
  const limit = spec?.limit.context ?? 0;
  let score = 0;

  if (/\b(mini|haiku|flash|lite|instant|small)\b/.test(normalized) || /\b(mini|haiku|flash|lite|small)\b/.test(family)) score += 120;
  if (/\b(coder|code|codestral)\b/.test(normalized) || /\bcode\b/.test(family)) score += 40;
  if (/\b(opus|large|pro)\b/.test(normalized) || /\b(large|pro)\b/.test(family)) score -= 60;
  if (spec?.reasoning) score -= 25;
  if (limit > 0 && limit <= 128_000) score += 80;
  else if (limit <= 200_000) score += 60;
  else if (limit <= 400_000) score += 35;
  else if (limit >= 1_000_000) score -= 20;
  if ((spec?.limit.output ?? 0) > 0 && (spec?.limit.output ?? 0) <= 16_384) score += 10;

  return score;
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

function listCustomConfiguredProviders(): DetectedProvider[] {
  const knownProviderIds = new Set<string>(BUILTIN_PROVIDER_IDS);
  const configured: DetectedProvider[] = [];
  for (const providerId of listConfiguredProviderIds()) {
    if (knownProviderIds.has(providerId)) continue;
    const models = getConfiguredProviderModels(providerId);
    const baseUrl = getConfiguredProviderBaseUrl(providerId);
    const apiType = getConfiguredProviderApi(providerId);
    const disabled = !!loadConfig().providers?.[providerId]?.disabled;
    const reason = disabled
      ? "disabled"
      : models.length === 0
        ? "configure models.json models"
        : !baseUrl
          ? "set baseUrl in models.json"
          : !apiType
            ? "set api in models.json"
            : getConfiguredProviderApiKey(providerId)
              ? "API key"
              : "configured";
    configured.push({
      id: providerId,
      name: getConfiguredProviderName(providerId) ?? providerId,
      available: !disabled && models.length > 0 && !!baseUrl && !!apiType,
      reason,
    });
  }
  return configured;
}

export async function inspectProviders(): Promise<DetectedProvider[]> {
  const results: DetectedProvider[] = [];
  const config = loadConfig();
  const providerDisabled = (providerId: string): boolean => !!config.providers?.[providerId]?.disabled;
  const anthropicCredential = getProviderCredential("anthropic");
  const codexCredential = getProviderCredential("codex");
  const githubCopilotCredential = getProviderCredential("github-copilot");
  const googleGeminiCliCredential = getProviderCredential("google-gemini-cli");
  const googleAntigravityCredential = getProviderCredential("google-antigravity");
  const claudeCli = hasNativeCommand("claude");
  const codexCli = hasNativeCommand("codex");

  // Cloud/native providers - only show when a usable auth mode exists
  results.push(
    providerDisabled("anthropic")
      ? { id: "anthropic", name: "Anthropic", available: false, reason: "disabled" }
      : anthropicCredential.kind === "native_oauth"
          ? { id: "anthropic", name: "Claude Code", available: claudeCli, reason: claudeCli ? "native login" : "claude CLI missing" }
          : { id: "anthropic", name: "Claude Code", available: false, reason: "run /login anthropic" },
    providerDisabled("codex")
      ? { id: "codex", name: "Codex", available: false, reason: "disabled" }
      : codexCredential.kind === "native_oauth"
          ? { id: "codex", name: "Codex", available: codexCli, reason: codexCli ? "native login" : "codex CLI missing" }
          : { id: "codex", name: "Codex", available: false, reason: "run /login codex" },
    providerDisabled("github-copilot")
      ? { id: "github-copilot", name: "GitHub Copilot", available: false, reason: "disabled" }
      : githubCopilotCredential.kind === "native_oauth"
        ? { id: "github-copilot", name: "GitHub Copilot", available: true, reason: "OAuth login" }
        : { id: "github-copilot", name: "GitHub Copilot", available: false, reason: "run /login github-copilot" },
    providerDisabled("google-gemini-cli")
      ? { id: "google-gemini-cli", name: "Google Cloud Code Assist", available: false, reason: "disabled" }
      : googleGeminiCliCredential.kind === "native_oauth"
        ? { id: "google-gemini-cli", name: "Google Cloud Code Assist", available: true, reason: "OAuth login" }
        : { id: "google-gemini-cli", name: "Google Cloud Code Assist", available: false, reason: "run /login google-gemini-cli" },
    providerDisabled("google-antigravity")
      ? { id: "google-antigravity", name: "Antigravity", available: false, reason: "disabled" }
      : googleAntigravityCredential.kind === "native_oauth"
        ? { id: "google-antigravity", name: "Antigravity", available: true, reason: "OAuth login" }
        : { id: "google-antigravity", name: "Antigravity", available: false, reason: "run /login google-antigravity" },
  );

  return results;
}

export async function detectProviders(): Promise<DetectedProvider[]> {
  const diagnostics = await inspectProviders();
  const results = diagnostics.filter((provider) => provider.available);
  return results;
}

/** Pick the best default provider from detected ones */
export function pickDefault(providers: DetectedProvider[]): DetectedProvider | undefined {
  // Prefer cloud providers that are available, then local
  const priority = ["codex", "anthropic", "github-copilot", "google-gemini-cli", "google-antigravity", "openai", "google", "groq", "mistral", "xai", "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm"];
  for (const id of priority) {
    const p = providers.find((x) => x.id === id && x.available);
    if (p && isSelectableDetectedProvider(p)) return p;
  }
  return undefined;
}

export function pickCheapestDetectedModel(providers: DetectedProvider[]): CheapestDetectedModel | null {
  const available = providers.filter((provider) => provider.available);
  const selectable = available.filter(isSelectableDetectedProvider);
  const candidates = (selectable.length > 0 ? selectable : available)
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
    || tokenEfficiencyScore(right.providerId, right.modelId) - tokenEfficiencyScore(left.providerId, left.modelId)
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
