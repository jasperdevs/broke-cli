import {
  getConfiguredProviderModel,
  getConfiguredProviderModelOverride,
  type ConfiguredModelDefinition,
} from "../core/models-config.js";
import type { ModelSpec } from "./model-types.js";

function asConfiguredModelSpec(providerId: string, model: ConfiguredModelDefinition): ModelSpec {
  return {
    id: model.id,
    name: model.name ?? model.id,
    providerId,
    reasoning: model.reasoning,
    modalities: {
      input: model.input,
      output: ["text"],
    },
    cost: model.cost ? {
      input: model.cost.input ?? 0,
      output: model.cost.output ?? 0,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    } : { input: 0, output: 0 },
    limit: {
      context: model.contextWindow,
      output: model.maxTokens,
    },
  };
}

export function mergeConfiguredModelOverride(base: ModelSpec | null, providerId: string, modelId: string): ModelSpec | null {
  const configuredModel = getConfiguredProviderModel(providerId, modelId);
  const configuredOverride = getConfiguredProviderModelOverride(providerId, modelId);
  if (!configuredModel && !configuredOverride) return base;
  const seed = configuredModel
    ? asConfiguredModelSpec(providerId, configuredModel)
    : base ?? {
      id: modelId,
      name: modelId,
      providerId,
      cost: { input: 0, output: 0 },
      limit: {},
    };
  return {
    ...seed,
    ...base,
    ...configuredOverride,
    providerId,
    id: modelId,
    name: configuredOverride?.name ?? configuredModel?.name ?? base?.name ?? modelId,
    modalities: {
      input: configuredOverride?.input ?? configuredModel?.input ?? base?.modalities?.input,
      output: base?.modalities?.output ?? seed.modalities?.output,
    },
    cost: {
      ...(seed.cost ?? { input: 0, output: 0 }),
      ...(base?.cost ?? {}),
      ...(configuredOverride?.cost ?? {}),
    },
    limit: {
      ...(seed.limit ?? {}),
      ...(base?.limit ?? {}),
      context: configuredOverride?.contextWindow ?? configuredModel?.contextWindow ?? base?.limit.context,
      output: configuredOverride?.maxTokens ?? configuredModel?.maxTokens ?? base?.limit.output,
    },
  };
}

export function getConfiguredModelSpec(providerId: string, modelId: string): ModelSpec | null {
  const configuredModel = getConfiguredProviderModel(providerId, modelId);
  return configuredModel ? asConfiguredModelSpec(providerId, configuredModel) : null;
}
