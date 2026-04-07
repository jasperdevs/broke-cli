import type { ProviderRegistry } from "../ai/provider-registry.js";
import type { ModelHandle } from "../ai/providers.js";
import { getSmallModelId } from "../ai/router.js";
import { getConfiguredModelPreference, type ModelPreferenceSlot } from "../core/config.js";
import type { TurnArchetype } from "../core/turn-policy.js";

export type SpecialistModelRole = Exclude<ModelPreferenceSlot, "default" | "small">;

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
  const slots: ModelPreferenceSlot[] = ["default", "small", "review", "planning", "ui", "architecture"];
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

export function resolveConfiguredModelHandle(
  providerRegistry: ProviderRegistry,
  activeModel: ModelHandle,
  currentModelId: string,
  slot: ModelPreferenceSlot,
): { model: ModelHandle; modelId: string; key: string } | null {
  const resolved = getResolvedModelPreference(slot, activeModel.provider.id);
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
