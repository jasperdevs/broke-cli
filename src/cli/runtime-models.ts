import type { DetectedProvider } from "../ai/detect.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import type { ModelHandle } from "../ai/providers.js";
import { getPrettyModelName, getProviderNativePreferredDisplayModelIds } from "../ai/model-catalog.js";
import { getSettings } from "../core/config.js";
import type { ModelOption } from "../ui-contracts.js";
import { listResolvedModelPreferences, resolveConfiguredModelHandle, type SpecialistModelRole } from "./model-routing.js";

export const AUTO_MODEL_PROVIDER_ID = "__auto__";
export const AUTO_MODEL_ID = "__auto__";
const MODEL_BADGE_ORDER = ["now", "default", "small", "btw", "review", "plan", "ui", "arch", "auto"] as const;

export function withAutoModelOption(options: ModelOption[]): ModelOption[] {
  if (options.length === 0 || options.some((option) => option.providerId === AUTO_MODEL_PROVIDER_ID && option.modelId === AUTO_MODEL_ID)) {
    return options;
  }
  return [{
    providerId: AUTO_MODEL_PROVIDER_ID,
    providerName: "Automatic routing",
    modelId: AUTO_MODEL_ID,
    displayName: "Auto",
    active: false,
    badges: getSettings().autoRoute ? ["now", "auto"] : ["auto"],
    tone: "auto",
  }, ...options];
}

export function filterUnsupportedRuntimeModelOptions(
  options: ModelOption[],
  activeModel: ModelHandle | null,
  providers: DetectedProvider[],
): ModelOption[] {
  const codexNativeActive = activeModel?.provider.id === "codex" && activeModel.runtime === "native-cli";
  const codexNativeDetected = providers.some((provider) => provider.id === "codex" && provider.reason === "native login");
  if (!codexNativeActive && !codexNativeDetected) return options;
  const allowedCodexModels = new Set(getProviderNativePreferredDisplayModelIds("codex"));
  if (allowedCodexModels.size === 0) return options;
  return options.filter((option) => option.providerId !== "codex" || allowedCodexModels.has(option.modelId));
}

export function rebuildSmallModelState(
  providerRegistry: ProviderRegistry,
  activeModel: ModelHandle | null,
  currentModelId: string,
): { smallModel: ModelHandle | null; smallModelId: string } {
  if (!activeModel) return { smallModel: null, smallModelId: "" };
  if (activeModel.provider.id === "codex" && activeModel.runtime === "native-cli") {
    return { smallModel: null, smallModelId: "" };
  }
  const resolved = resolveConfiguredModelHandle(providerRegistry, activeModel, currentModelId, "small");
  if (!resolved || resolved.modelId === currentModelId) {
    return { smallModel: null, smallModelId: "" };
  }
  return { smallModel: resolved.model, smallModelId: resolved.modelId };
}

export function resolveSpecialistRuntimeModel(
  providerRegistry: ProviderRegistry,
  activeModel: ModelHandle | null,
  currentModelId: string,
  role: SpecialistModelRole,
): { model: ModelHandle; modelId: string } | null {
  if (!activeModel) return null;
  const resolved = resolveConfiguredModelHandle(providerRegistry, activeModel, currentModelId, role);
  return resolved ? { model: resolved.model, modelId: resolved.modelId } : null;
}

export interface AutoFallbackModel {
  key: string;
  model: ModelHandle;
  modelId: string;
  providerName: string;
}

export function resolveAutoFallbackModels(
  providerRegistry: ProviderRegistry,
  activeModel: ModelHandle,
  currentModelId: string,
  providers: DetectedProvider[],
  attemptedKeys: ReadonlySet<string>,
): AutoFallbackModel[] {
  const currentKey = `${activeModel.provider.id}/${currentModelId}`;
  const availableProviderIds = new Set(providers.filter((provider) => provider.available !== false).map((provider) => provider.id));
  const options = buildVisibleRuntimeModelOptions(providerRegistry, activeModel, currentModelId, providers)
    .filter((option) =>
      option.providerId !== AUTO_MODEL_PROVIDER_ID
      && option.modelId !== AUTO_MODEL_ID
      && availableProviderIds.has(option.providerId));
  const currentIndex = options.findIndex((option) => `${option.providerId}/${option.modelId}` === currentKey);
  const ordered = currentIndex >= 0
    ? [...options.slice(currentIndex + 1), ...options.slice(0, currentIndex)]
    : options;
  const fallbacks: AutoFallbackModel[] = [];
  for (const option of ordered) {
    const requestedKey = `${option.providerId}/${option.modelId}`;
    if (attemptedKeys.has(requestedKey)) continue;
    try {
      const model = providerRegistry.createModel(option.providerId, option.modelId);
      const key = `${model.provider.id}/${model.modelId}`;
      if (attemptedKeys.has(key) || key === currentKey) continue;
      fallbacks.push({ key, model, modelId: model.modelId, providerName: model.provider.name });
    } catch {
      // Ignore stale visible options; auto fallback should continue to the next viable model.
    }
  }
  return fallbacks;
}

function modelBadgeRank(badges: readonly string[] | undefined): number {
  if (!badges || badges.length === 0) return MODEL_BADGE_ORDER.length;
  const ranks = badges.map((badge) => MODEL_BADGE_ORDER.indexOf(badge as (typeof MODEL_BADGE_ORDER)[number])).filter((rank) => rank >= 0);
  return ranks.length > 0 ? Math.min(...ranks) : MODEL_BADGE_ORDER.length;
}

export function buildVisibleRuntimeModelOptions(
  providerRegistry: ProviderRegistry,
  activeModel: ModelHandle | null,
  currentModelId: string,
  providers: DetectedProvider[],
): ModelOption[] {
  const fallbackProviderId = activeModel?.provider.id ?? providers[0]?.id ?? "openai";
  const preferences = listResolvedModelPreferences(fallbackProviderId);
  const currentKey = activeModel ? `${activeModel.provider.id}/${currentModelId}` : "";
  const options = filterUnsupportedRuntimeModelOptions(providerRegistry
    .buildVisibleModelOptions(activeModel, currentModelId, getSettings().scopedModels)
    .map((option) => {
      const key = `${option.providerId}/${option.modelId}`;
      const badges: string[] = [];
      if (key === currentKey) badges.push("now");
      if (preferences.default?.key === key) badges.push("default");
      if (preferences.small?.key === key) badges.push("small");
      if (preferences.btw?.key === key) badges.push("btw");
      if (preferences.review?.key === key) badges.push("review");
      if (preferences.planning?.key === key) badges.push("plan");
      if (preferences.ui?.key === key) badges.push("ui");
      if (preferences.architecture?.key === key) badges.push("arch");
      return {
        ...option,
        displayName: getPrettyModelName(option.modelId, option.providerId),
        badges,
      };
    }), activeModel, providers);
  options.sort((a, b) => {
    const rank = modelBadgeRank(a.badges) - modelBadgeRank(b.badges);
    if (rank !== 0) return rank;
    if (a.providerName !== b.providerName) return a.providerName.localeCompare(b.providerName);
    return (a.displayName ?? a.modelId).localeCompare(b.displayName ?? b.modelId);
  });
  return withAutoModelOption(options);
}
