import type { DetectedProvider } from "../ai/detect.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import type { ModelHandle } from "../ai/providers.js";
import { getPrettyModelName } from "../ai/model-catalog.js";
import { getSettings } from "../core/config.js";
import type { ModelOption } from "../ui-contracts.js";
import { listResolvedModelPreferences, resolveConfiguredModelHandle, type SpecialistModelRole } from "./model-routing.js";

const AUTO_MODEL_PROVIDER_ID = "__auto__";
const AUTO_MODEL_ID = "__auto__";

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

export function buildVisibleRuntimeModelOptions(
  providerRegistry: ProviderRegistry,
  activeModel: ModelHandle | null,
  currentModelId: string,
  providers: DetectedProvider[],
): ModelOption[] {
  const fallbackProviderId = activeModel?.provider.id ?? providers[0]?.id ?? "openai";
  const preferences = listResolvedModelPreferences(fallbackProviderId);
  const currentKey = activeModel ? `${activeModel.provider.id}/${currentModelId}` : "";
  const options = providerRegistry
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
    });
  if (options.length === 0) return options;
  return [{
    providerId: AUTO_MODEL_PROVIDER_ID,
    providerName: "Automatic routing",
    modelId: AUTO_MODEL_ID,
    displayName: "Auto",
    active: false,
    badges: getSettings().autoRoute ? ["now", "auto"] : ["auto"],
    tone: "auto" as const,
  }, ...options];
}
