import {
  getConfiguredProviderApi,
  getConfiguredProviderAuthHeader,
  getConfiguredProviderBaseUrl,
  getConfiguredProviderDefinition,
  getConfiguredProviderHeaders,
  getConfiguredProviderModels,
  getConfiguredProviderName,
  getConfiguredProviderDefaultModel,
  listConfiguredProviderIds,
} from "../core/models-config.js";
import { PROVIDERS, SUPPORTED_PROVIDER_ID_SET, getProviderInfo, setRuntimeProviderInfo, type ProviderInfo } from "./provider-definitions.js";

function inferProviderDisplayName(providerId: string): string {
  return providerId
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

export function applyConfiguredProviderOverrides(): void {
  for (const providerId of listConfiguredProviderIds()) {
    if (!SUPPORTED_PROVIDER_ID_SET.has(providerId)) continue;
    const existing = getProviderInfo(providerId);
    const configuredProvider = getConfiguredProviderDefinition(providerId);
    const configuredModels = getConfiguredProviderModels(providerId);
    const apiType = getConfiguredProviderApi(providerId) ?? existing?.apiType;
    const baseUrl = getConfiguredProviderBaseUrl(providerId) ?? existing?.baseUrl;
    if (!existing && (configuredModels.length === 0 || !apiType || !baseUrl)) {
      continue;
    }
    const configuredModelIds = configuredModels.map((model) => model.id);
    const mergedModels = existing
      ? [...new Set([...existing.models.filter((modelId) => !configuredModelIds.includes(modelId)), ...configuredModelIds])]
      : configuredModelIds;
    const preferredDefaultModel = getConfiguredProviderDefaultModel(providerId)
      ?? existing?.defaultModel
      ?? configuredModelIds[0]
      ?? "default";
    const defaultModel = mergedModels.includes(preferredDefaultModel) || mergedModels.length === 0
      ? preferredDefaultModel
      : mergedModels[0]!;
    const provider: ProviderInfo = {
      id: providerId,
      name: getConfiguredProviderName(providerId) ?? existing?.name ?? inferProviderDisplayName(providerId),
      defaultModel,
      models: mergedModels,
      apiType,
      compat: configuredProvider?.compat ?? existing?.compat,
      baseUrl,
      headers: getConfiguredProviderHeaders(providerId) ?? existing?.headers,
      authHeader: getConfiguredProviderAuthHeader(providerId) || existing?.authHeader,
      custom: existing?.custom ?? !PROVIDERS[providerId],
    };
    setRuntimeProviderInfo(provider);
  }
}
