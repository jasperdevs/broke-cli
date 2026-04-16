import { getPrettyModelName } from "./model-catalog.js";
import { getProviderInfo } from "./provider-definitions.js";

export function getProviderModelLabel(modelId: string, providerId?: string, providerName?: string): string {
  const model = getPrettyModelName(modelId, providerId);
  const provider = providerName ?? (providerId ? getProviderInfo(providerId)?.name : undefined);
  return provider && provider !== "---" ? `${provider} / ${model}` : model;
}
