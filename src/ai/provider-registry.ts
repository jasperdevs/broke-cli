import { detectProviders } from "./detect.js";
import {
  createModel,
  getDisplayModels,
  getProviderInfo,
  getProviderPopularity,
  isProviderRuntimeSelectable,
  listProviders,
  refreshLocalModels,
  supportsProviderModel,
  syncCloudProviderModelsFromCatalog,
  type ModelHandle,
} from "./providers.js";
import { getConfiguredProviderBaseUrl } from "../core/models-config.js";
import { getProviderCredential } from "../core/provider-credentials.js";
import { applyConfiguredProviderOverrides } from "./provider-overrides.js";
import { LOCAL_PROVIDER_IDS, resetRuntimeProviders } from "./provider-definitions.js";
import { loadModelCatalog } from "./model-catalog.js";

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
  if (providerId === "github-copilot") return "GitHub Copilot";
  if (providerId === "google-gemini-cli") return "Google Cloud Code Assist";
  if (providerId === "google-antigravity") return "Antigravity";
  return "native provider";
}

function isDetectedProviderRuntimeSelectable(provider: { id: string; reason: string }): boolean {
  if (LOCAL_PROVIDER_IDS.has(provider.id)) return true;
  if ((provider.id === "anthropic" || provider.id === "codex") && provider.reason === "native login") return true;
  if (provider.id === "github-copilot" && provider.reason === "OAuth login") return true;
  return isProviderRuntimeSelectable(provider.id);
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
      resetRuntimeProviders();
      await loadModelCatalog();
      syncCloudProviderModelsFromCatalog();
      this.providers = await detectProviders();
      await refreshLocalModels(this.providers.map((provider) => provider.id));
      applyConfiguredProviderOverrides();
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
      if (credential.kind === "native_oauth") return "connected · native";
      return "connected";
    }
    if (credential.kind === "native_oauth") {
      return `${getNativeCliLabel(providerId)} login found`;
    }
    if (providerId in LOCAL_PROVIDER_DEFAULTS) return "local APIs disabled";
    return "not connected";
  }

  buildVisibleModelOptions(
    activeModel: ModelHandle | null,
    currentModelId: string,
    pinnedModels: string[],
    preservedModels: string[] = [],
  ): VisibleModelOption[] {
    const cacheKey = JSON.stringify({
      providers: this.providers.map((provider) => provider.id),
      activeProvider: activeModel?.provider.id ?? "",
      currentModelId,
      pinnedModels: [...pinnedModels].sort(),
      preservedModels: [...preservedModels].sort(),
    });
    if (cacheKey === this.visibleModelOptionsCacheKey) {
      return this.visibleModelOptionsCache;
    }

    const visibleProviderIds = new Set(
      this.providers
        .filter((provider) => isDetectedProviderRuntimeSelectable(provider))
        .map((provider) => provider.id),
    );
    const currentKey = activeModel ? `${activeModel.provider.id}/${currentModelId}` : "";
    const options: VisibleModelOption[] = [];

    for (const provider of listProviders().filter((item) => visibleProviderIds.has(item.id))) {
      const preserve = pinnedModels
        .filter((entry) => entry.startsWith(`${provider.id}/`))
        .map((entry) => entry.slice(provider.id.length + 1));
      preserve.push(
        ...preservedModels
          .filter((entry) => entry.startsWith(`${provider.id}/`))
          .map((entry) => entry.slice(provider.id.length + 1)),
      );
      if (currentKey.startsWith(`${provider.id}/`)) {
        preserve.push(currentModelId);
      }
      const supportedPreserve = [...new Set(preserve.filter((modelId) => supportsProviderModel(provider.id, modelId)))];
      const visibleModels = getDisplayModels(provider.id, supportedPreserve);
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
    return getConfiguredProviderBaseUrl(providerId);
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
