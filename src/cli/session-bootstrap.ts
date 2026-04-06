import { pickDefault, type DetectedProvider } from "../ai/detect.js";
import type { ModelHandle } from "../ai/providers.js";
import { loadPricing } from "../ai/cost.js";
import { getSmallModelId } from "../ai/router.js";
import { buildSystemPrompt } from "../core/context.js";
import { getSettings, updateSetting, type Mode } from "../core/config.js";
import type { Session } from "../core/session.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";

interface BootstrapApp {
  addMessage(role: "user" | "assistant" | "system", content: string): void;
  setModel(provider: string, model: string): void;
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
  opts: { broke?: boolean; model?: string };
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

  if (opts.broke) {
    const def = pickDefault(providers);
    if (def) {
      providerId = def.id;
      modelId = getSmallModelId(def.id);
    }
  } else if (opts.model) {
    const slashIdx = opts.model.indexOf("/");
    if (slashIdx > 0) {
      providerId = opts.model.slice(0, slashIdx);
      modelId = opts.model.slice(slashIdx + 1);
    } else {
      const def = pickDefault(providers);
      providerId = def?.id ?? "openai";
      modelId = opts.model;
    }
  } else {
    const lastModel = getSettings().lastModel;
    if (lastModel) {
      const slashIdx = lastModel.indexOf("/");
      if (slashIdx > 0) {
        providerId = lastModel.slice(0, slashIdx);
        modelId = lastModel.slice(slashIdx + 1);
      }
    }
    if (!providerId) {
      const def = pickDefault(providers);
      if (!def) {
        app.addMessage("system", "No providers found. Run /connect, set an API key, or start a local model server.");
        return {
          providers,
          activeModel: null,
          currentModelId: "",
          smallModel: null,
          smallModelId: "",
          systemPrompt: buildSystemPrompt(process.cwd(), undefined, currentMode, getSettings().cavemanLevel ?? "off"),
        };
      }
      providerId = def.id;
    }
  }

  try {
    const activeModel = providerRegistry.createModel(providerId!, modelId);
    const currentModelId = modelId ?? activeModel.provider.defaultModel;
    const systemPrompt = buildSystemPrompt(process.cwd(), providerId!, currentMode, getSettings().cavemanLevel ?? "off");
    app.setModel(activeModel.provider.name, currentModelId);
    app.setMode(currentMode);
    session.setProviderModel(activeModel.provider.name, currentModelId);
    updateSetting("lastModel", `${activeModel.provider.id}/${currentModelId}`);

    let smallModel: ModelHandle | null = null;
    let smallModelId = "";
    const cheapId = getSmallModelId(activeModel.provider.id);
    if (cheapId && cheapId !== currentModelId) {
      try {
        smallModel = providerRegistry.createModel(activeModel.provider.id, cheapId);
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
      systemPrompt: buildSystemPrompt(process.cwd(), providerId, currentMode, getSettings().cavemanLevel ?? "off"),
    };
  }
}
