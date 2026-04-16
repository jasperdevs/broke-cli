import type { ProviderRegistry } from "../ai/provider-registry.js";
import type { ModelHandle } from "../ai/providers.js";
import { resolveModelReferencePattern } from "../ai/model-reference.js";
import { getSmallModelId } from "../ai/router.js";
import { getConfiguredModelPreference, getSettings, type Mode, type ModelPreferenceSlot } from "../core/config.js";
import type { TurnArchetype } from "../core/turn-policy.js";

export type SpecialistModelRole = Exclude<ModelPreferenceSlot, "default" | "small" | "btw">;

export interface ResolvedModelRef {
  providerId: string;
  modelId: string;
  key: string;
}

function normalizeModelRef(raw: string | undefined, fallbackProviderId: string): ResolvedModelRef | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0) {
    const providerId = trimmed.slice(0, slashIndex).trim();
    const modelId = trimmed.slice(slashIndex + 1).trim();
    if (!providerId || !modelId) return null;
    return { providerId, modelId, key: `${providerId}/${modelId}` };
  }
  return { providerId: fallbackProviderId, modelId: trimmed, key: `${fallbackProviderId}/${trimmed}` };
}

export function getResolvedModelPreference(slot: ModelPreferenceSlot, fallbackProviderId: string): ResolvedModelRef | null {
  if (slot === "small") {
    const configured = normalizeModelRef(getConfiguredModelPreference("small"), fallbackProviderId);
    if (configured) return configured;
    const fallbackModelId = getSmallModelId(fallbackProviderId);
    return fallbackModelId ? normalizeModelRef(fallbackModelId, fallbackProviderId) : null;
  }
  return normalizeModelRef(getConfiguredModelPreference(slot), fallbackProviderId);
}

export function listResolvedModelPreferences(fallbackProviderId: string): Partial<Record<ModelPreferenceSlot, ResolvedModelRef>> {
  const slots: ModelPreferenceSlot[] = ["default", "small", "btw", "review", "planning", "ui", "architecture"];
  const result: Partial<Record<ModelPreferenceSlot, ResolvedModelRef>> = {};
  for (const slot of slots) {
    const resolved = getResolvedModelPreference(slot, fallbackProviderId);
    if (resolved) result[slot] = resolved;
  }
  return result;
}

export function resolvePreferredSpecialistRole(userMessage: string, archetype: TurnArchetype): SpecialistModelRole | null {
  const msg = userMessage.toLowerCase();
  if (archetype === "review") return "review";
  if (/\b(architecture|architect|service boundary|service boundaries|boundary|boundaries|system design|tradeoff|migration plan|api design|domain model)\b/i.test(msg)) {
    return "architecture";
  }
  if (/\b(ui|ux|frontend|front-end|css|tailwind|layout|landing page|landing|component styling|design system|typography|spacing|responsive)\b/i.test(msg)) {
    return "ui";
  }
  if (archetype === "planning" || archetype === "research") return "planning";
  return null;
}

export function resolvePreferredMode(
  userMessage: string,
  archetype: TurnArchetype,
  currentMode: Mode,
): { mode: Mode; reason: string } | null {
  const msg = userMessage.toLowerCase();
  let nextMode: Mode | null = null;
  let reason = "";

  if (/\b(plan|planning|roadmap|strategy|tradeoff|approach)\b/i.test(msg) || archetype === "planning") {
    nextMode = "plan";
    reason = "planning turn";
  } else if (/\b(architecture|architect|service boundary|service boundaries|system design|migration plan|api design|domain model)\b/i.test(msg)) {
    nextMode = "plan";
    reason = "architecture turn";
  } else if (archetype === "edit" || archetype === "bugfix" || archetype === "shell") {
    nextMode = "build";
    reason = archetype === "shell" ? "execution turn" : "implementation turn";
  } else if (/\b(ui|ux|frontend|front-end|css|layout|spacing|responsive|component styling)\b/i.test(msg)) {
    nextMode = "build";
    reason = "ui implementation turn";
  }

  if (!nextMode || nextMode === currentMode) return null;
  return { mode: nextMode, reason };
}

export function resolveConfiguredModelHandle(
  providerRegistry: ProviderRegistry,
  activeModel: ModelHandle,
  currentModelId: string,
  slot: ModelPreferenceSlot,
): { model: ModelHandle; modelId: string; key: string } | null {
  const configured = getConfiguredModelPreference(slot);
  const raw = slot === "small" && !configured
    ? getSmallModelId(activeModel.provider.id)
    : configured;
  if (!raw) return null;

  const visibleOptions = providerRegistry.buildVisibleModelOptions(
    activeModel,
    currentModelId,
    getSettings().scopedModels,
    [`${activeModel.provider.id}/${currentModelId}`],
  );
  const matched = resolveModelReferencePattern(raw, visibleOptions);
  const resolved = matched
    ? { providerId: matched.providerId, modelId: matched.modelId, key: `${matched.providerId}/${matched.modelId}` }
    : normalizeModelRef(raw, activeModel.provider.id);
  if (!resolved) return null;
  if (resolved.providerId === activeModel.provider.id && resolved.modelId === currentModelId) {
    return { model: activeModel, modelId: currentModelId, key: resolved.key };
  }
  try {
    const model = providerRegistry.createModel(resolved.providerId, resolved.modelId);
    return { model, modelId: resolved.modelId, key: resolved.key };
  } catch {
    return null;
  }
}
