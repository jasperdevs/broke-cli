import { loadConfig } from "../core/config.js";
import { getProviderCredential } from "../core/provider-credentials.js";
import {
  getModelPricing,
  getProviderDefaultModelId,
  getProviderPreferredDisplayModelIds,
  getProviderSmallModelId,
  getModelSpec,
} from "./model-catalog.js";
import { getProviderInfo, SUPPORTED_PROVIDER_IDS } from "./provider-definitions.js";
import { isProviderRuntimeSelectable } from "./provider-runtime.js";

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

function isSelectableDetectedProvider(provider: DetectedProvider): boolean {
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
  const ordered = [
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

function providerEnvVar(providerId: string): string {
  return ({
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    mistral: "MISTRAL_API_KEY",
    xai: "XAI_API_KEY",
  } as Record<string, string>)[providerId] ?? `${providerId.toUpperCase()}_API_KEY`;
}

export async function inspectProviders(): Promise<DetectedProvider[]> {
  const config = loadConfig();
  return SUPPORTED_PROVIDER_IDS.map((providerId) => {
    const info = getProviderInfo(providerId);
    if (config.providers?.[providerId]?.disabled) {
      return { id: providerId, name: info?.name ?? providerId, available: false, reason: "disabled" };
    }
    const credential = getProviderCredential(providerId);
    return credential.kind === "api_key"
      ? { id: providerId, name: info?.name ?? providerId, available: true, reason: credential.source ? `configured auth (${credential.source})` : "configured auth" }
      : { id: providerId, name: info?.name ?? providerId, available: false, reason: `set ${providerEnvVar(providerId)}` };
  });
}

export async function detectProviders(): Promise<DetectedProvider[]> {
  const diagnostics = await inspectProviders();
  return diagnostics.filter((provider) => provider.available);
}

export function pickDefault(providers: DetectedProvider[]): DetectedProvider | undefined {
  for (const id of SUPPORTED_PROVIDER_IDS) {
    const provider = providers.find((entry) => entry.id === id && entry.available);
    if (provider && isSelectableDetectedProvider(provider)) return provider;
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
        return {
          providerId: provider.id,
          modelId,
          input: hasCatalogPricing ? pricing.input : 0,
          output: hasCatalogPricing ? pricing.output : 0,
          priced: hasCatalogPricing,
          providerIndex,
          priorityIndex,
        };
      }),
    );

  if (candidates.length === 0) return null;

  candidates.sort((left, right) =>
    Number(right.priced) - Number(left.priced)
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
