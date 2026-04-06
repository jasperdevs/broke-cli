import { detectProviders } from "./detect.js";
import {
  createModel,
  getDisplayModels,
  getProviderInfo,
  getProviderPopularity,
  listProviders,
  refreshLocalModels,
  supportsProviderModel,
  syncCloudProviderModelsFromCatalog,
  type ModelHandle,
} from "./providers.js";
import { getBaseUrl, getProviderCredential } from "../core/config.js";

const LOCAL_PROVIDER_DEFAULTS: Record<string, string> = {
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  llamacpp: "http://127.0.0.1:8080/v1",
  jan: "http://127.0.0.1:1337/v1",
  vllm: "http://127.0.0.1:8000/v1",
};

export interface VisibleModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  active: boolean;
}

function getNativeCliLabel(providerId: string): string {
  if (providerId === "anthropic") return "Claude Code";
  if (providerId === "codex") return "Codex";
  return "native provider";
}

export class ProviderRegistry {
  private providers: Awaited<ReturnType<typeof detectProviders>> = [];
  private refreshCacheAt = 0;
  private refreshInFlight: Promise<Awaited<ReturnType<typeof detectProviders>>> | null = null;
  private visibleModelOptionsCacheKey = "";
  private visibleModelOptionsCache: VisibleModelOption[] = [];
  private static readonly REFRESH_TTL_MS = 5000;

  getDetectedProviders(): Awaited<ReturnType<typeof detectProviders>> {
    return this.providers;
  }

  async refresh(force = false): Promise<Awaited<ReturnType<typeof detectProviders>>> {
    const now = Date.now();
    if (!force && this.refreshCacheAt > 0 && now - this.refreshCacheAt < ProviderRegistry.REFRESH_TTL_MS) {
      return this.providers;
    }
    if (!force && this.refreshInFlight) {
      return this.refreshInFlight;
    }
    const refreshPromise = (async () => {
      this.providers = await detectProviders();
      syncCloudProviderModelsFromCatalog();
      await refreshLocalModels([...Object.keys(LOCAL_PROVIDER_DEFAULTS)]);
      this.refreshCacheAt = Date.now();
      this.visibleModelOptionsCacheKey = "";
      return this.providers;
    })();
    this.refreshInFlight = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      this.refreshInFlight = null;
    }
  }

  getConnectStatus(providerId: string): string {
    const detectedIds = new Set(this.providers.map((provider) => provider.id));
    const credential = getProviderCredential(providerId);
    if (detectedIds.has(providerId)) {
      if (providerId in LOCAL_PROVIDER_DEFAULTS) return "connected · local";
      if (credential.kind === "native_oauth") return "connected · native";
      if (credential.kind === "api_key") return "connected · ready";
      return "connected";
    }
    if (credential.kind === "native_oauth") {
      return `${getNativeCliLabel(providerId)} login found`;
    }
    if (credential.kind === "api_key") return "API key found";
    if (providerId in LOCAL_PROVIDER_DEFAULTS) return "local endpoint";
    return "not connected";
  }

  buildVisibleModelOptions(
    activeModel: ModelHandle | null,
    currentModelId: string,
    pinnedModels: string[],
  ): VisibleModelOption[] {
    const cacheKey = JSON.stringify({
      providers: this.providers.map((provider) => provider.id),
      activeProvider: activeModel?.provider.id ?? "",
      currentModelId,
      pinnedModels: [...pinnedModels].sort(),
    });
    if (cacheKey === this.visibleModelOptionsCacheKey) {
      return this.visibleModelOptionsCache;
    }

    const visibleProviderIds = new Set(this.providers.map((provider) => provider.id));
    for (const localProviderId of Object.keys(LOCAL_PROVIDER_DEFAULTS)) visibleProviderIds.add(localProviderId);
    if (activeModel?.provider.id) visibleProviderIds.add(activeModel.provider.id);
    const currentKey = activeModel ? `${activeModel.provider.id}/${currentModelId}` : "";
    const options: VisibleModelOption[] = [];

    for (const provider of listProviders().filter((item) => visibleProviderIds.has(item.id))) {
      const preserve = pinnedModels
        .filter((entry) => entry.startsWith(`${provider.id}/`))
        .map((entry) => entry.slice(provider.id.length + 1));
      if (currentKey.startsWith(`${provider.id}/`)) {
        preserve.push(currentModelId);
      }
      const visibleModels = [...new Set([...getDisplayModels(provider.id, preserve), ...preserve])];
      for (const modelId of visibleModels) {
        options.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId,
          active: pinnedModels.includes(`${provider.id}/${modelId}`),
        });
      }
    }

    options.sort((a, b) => {
      const aPinned = a.active ? 0 : 1;
      const bPinned = b.active ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;

      const providerDiff = getProviderPopularity(a.providerId) - getProviderPopularity(b.providerId);
      if (providerDiff !== 0) return providerDiff;

      return a.modelId.localeCompare(b.modelId);
    });

    this.visibleModelOptionsCacheKey = cacheKey;
    this.visibleModelOptionsCache = options;
    return options;
  }

  getSavedBaseUrl(providerId: string): string | undefined {
    return getBaseUrl(providerId);
  }

  getProviderInfo(providerId: string) {
    return getProviderInfo(providerId);
  }

  createModel(providerId: string, modelId?: string): ModelHandle {
    return createModel(providerId, modelId);
  }

  hasVisibleModel(providerId: string, modelId: string): boolean {
    return supportsProviderModel(providerId, modelId);
  }
}

export { LOCAL_PROVIDER_DEFAULTS };
