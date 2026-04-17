import { pickCheapestDetectedModel, pickDefault, type DetectedProvider } from "../ai/detect.js";
import { resolveModelReferencePattern } from "../ai/model-reference.js";
import { resolveVisibleProviderModelId, shouldUseNativeProvider, type ModelHandle } from "../ai/providers.js";
import { loadPricing } from "../ai/cost.js";
import { getSmallModelId } from "../ai/router.js";
import { buildSystemPrompt } from "../core/context.js";
import { getSettings, loadConfig, updateSetting, type Mode } from "../core/config.js";
import type { Session } from "../core/session.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";

interface BootstrapApp {
  addMessage(role: "user" | "assistant" | "system", content: string): void;
  setModel(provider: string, model: string, meta?: { providerId?: string; runtime?: ModelHandle["runtime"] }): void;
  setMode(mode: Mode): void;
  clearStatus(): void;
}

export interface BootstrapResult {
  providers: DetectedProvider[];
  activeModel: ModelHandle | null;
  currentModelId: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  systemPrompt: string;
}

export async function bootstrapSession(options: {
  opts: { broke?: boolean; model?: string; provider?: string };
  app: BootstrapApp;
  session: Session;
  providerRegistry: ProviderRegistry;
  currentMode: Mode;
  refreshProviderState: (force?: boolean) => Promise<DetectedProvider[]>;
}): Promise<BootstrapResult> {
  const { opts, app, session, providerRegistry, currentMode, refreshProviderState } = options;
  await loadPricing();
  const providers = await refreshProviderState();

  let providerId: string | undefined;
  let modelId: string | undefined;
  const explicitModelRequest = !!opts.model;
  const explicitProviderRequest = !!opts.provider;
  let providerInModelRequest = false;

  if (opts.provider) {
    providerId = opts.provider;
  }

  if (opts.broke) {
    const cheapest = pickCheapestDetectedModel(providers);
    if (cheapest) {
      providerId = cheapest.providerId;
      modelId = cheapest.modelId;
    }
  } else if (opts.model) {
    const modelArg = opts.model.split(":")[0];
    const slashIdx = modelArg.indexOf("/");
    if (!providerId && slashIdx > 0) {
      providerId = modelArg.slice(0, slashIdx);
      modelId = modelArg.slice(slashIdx + 1);
      providerInModelRequest = true;
    } else if (providerId) {
      modelId = modelArg;
    } else {
      const def = pickDefault(providers);
      providerId = def?.id ?? "openai";
      modelId = modelArg;
    }
  } else {
    const config = loadConfig();
    if (config.defaultProvider) providerId = config.defaultProvider;
    if (!modelId && config.defaultModel) modelId = config.defaultModel;
    const lastModel = getSettings().lastModel;
    if (lastModel && lastModel !== "__auto__/__auto__") {
      const slashIdx = lastModel.indexOf("/");
      if (slashIdx > 0) {
        providerId = lastModel.slice(0, slashIdx);
        modelId = lastModel.slice(slashIdx + 1);
      }
    }
    if (!providerId) {
      const def = pickDefault(providers);
      if (!def) {
        app.addMessage("system", "No supported SDK model runtime found. Configure openai, anthropic, google, mistral, or xai.");
        return {
          providers,
          activeModel: null,
          currentModelId: "",
          smallModel: null,
          smallModelId: "",
          systemPrompt: buildSystemPrompt(process.cwd(), undefined, currentMode, getSettings().cavemanLevel ?? "auto"),
        };
      }
      providerId = def.id;
    }
  }

  try {
    let resolvedModelId = modelId;
    if (explicitModelRequest && modelId) {
      const visibleOptions = providerRegistry.buildVisibleModelOptions(null, "", getSettings().scopedModels);
      const matched = resolveModelReferencePattern((explicitProviderRequest || providerInModelRequest) && providerId ? `${providerId}/${modelId}` : modelId, visibleOptions);
      if (matched) {
        providerId = matched.providerId;
        resolvedModelId = matched.modelId;
      }
    }
    if (!explicitModelRequest && providerId && modelId) {
      resolvedModelId = resolveVisibleProviderModelId(providerId, modelId);
    }
    if (!explicitModelRequest && providerId && resolvedModelId && shouldUseNativeProvider(providerId) && !providerRegistry.hasVisibleModel(providerId, resolvedModelId)) {
      resolvedModelId = undefined;
    }
    const activeModel = providerRegistry.createModel(providerId!, resolvedModelId);
    const currentModelId = activeModel.modelId;
    const systemPrompt = buildSystemPrompt(process.cwd(), providerId!, currentMode, getSettings().cavemanLevel ?? "auto");
    app.setModel(activeModel.provider.name, currentModelId, {
      providerId: activeModel.provider.id,
      runtime: activeModel.runtime,
    });
    app.setMode(currentMode);
    session.setProviderModel(activeModel.provider.name, currentModelId);
    updateSetting("lastModel", `${activeModel.provider.id}/${currentModelId}`);

    let smallModel: ModelHandle | null = null;
    let smallModelId = "";
    const configuredSmallModel = loadConfig().defaultSmallModel?.trim();
    const configuredSmallProvider = configuredSmallModel?.includes("/")
      ? configuredSmallModel.slice(0, configuredSmallModel.indexOf("/"))
      : activeModel.provider.id;
    const configuredSmallId = configuredSmallModel?.includes("/")
      ? configuredSmallModel.slice(configuredSmallModel.indexOf("/") + 1)
      : configuredSmallModel;
    const cheapProviderId = configuredSmallId ? configuredSmallProvider : activeModel.provider.id;
    const cheapId = configuredSmallId || getSmallModelId(activeModel.provider.id);
    if (cheapId && !(cheapProviderId === activeModel.provider.id && cheapId === currentModelId)) {
      try {
        smallModel = providerRegistry.createModel(cheapProviderId, cheapId);
        smallModelId = cheapId;
      } catch {
        smallModel = null;
      }
    }
    app.clearStatus();
    return { providers, activeModel, currentModelId, smallModel, smallModelId, systemPrompt };
  } catch (err) {
    app.addMessage("system", `Failed to init ${providerId}: ${(err as Error).message}`);
    return {
      providers,
      activeModel: null,
      currentModelId: "",
      smallModel: null,
      smallModelId: "",
      systemPrompt: buildSystemPrompt(process.cwd(), providerId, currentMode, getSettings().cavemanLevel ?? "auto"),
    };
  }
}
