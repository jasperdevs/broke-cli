import type { DetectedProvider } from "../ai/detect.js";
import { getProviderCredential, updateProviderConfig } from "../core/config.js";
import { LOCAL_PROVIDER_DEFAULTS, type ProviderRegistry } from "../ai/provider-registry.js";

interface ConnectFlowItem {
  id: string;
  label: string;
  detail?: string;
}

interface ConnectFlowApp {
  addMessage(role: "user" | "assistant" | "system", content: string): void;
  showQuestion(prompt: string, options?: string[]): Promise<string>;
  openItemPicker(title: string, items: ConnectFlowItem[], onSelect: (id: string) => void): void;
}

const CONNECT_PROVIDER_ORDER = [
  "codex",
  "anthropic",
  "openai",
  "google",
  "groq",
  "mistral",
  "xai",
  "openrouter",
  "ollama",
  "lmstudio",
  "llamacpp",
  "jan",
  "vllm",
] as const;

function getNativeCliLabel(providerId: string): string {
  if (providerId === "anthropic") return "Claude Code";
  if (providerId === "codex") return "Codex";
  return "native provider";
}

export async function runConnectFlow(options: {
  providerId?: string;
  app: ConnectFlowApp;
  providerRegistry: ProviderRegistry;
  refreshProviderState: (force?: boolean) => Promise<DetectedProvider[]>;
  isSkippedPromptAnswer: (value: string | undefined | null) => boolean;
  isValidHttpBaseUrl: (value: string) => boolean;
}): Promise<void> {
  const { providerId, app, providerRegistry, refreshProviderState, isSkippedPromptAnswer, isValidHttpBaseUrl } = options;

  const selectedProviderId = providerId ?? await new Promise<string>((resolve) => {
    const items = CONNECT_PROVIDER_ORDER
      .map((id) => providerRegistry.getProviderInfo(id))
      .filter((info): info is NonNullable<ReturnType<ProviderRegistry["getProviderInfo"]>> => !!info)
      .map((info) => ({
        id: info.id,
        label: info.name,
        detail: providerRegistry.getConnectStatus(info.id),
      }));
    app.openItemPicker("Connect Provider", items, resolve);
  });

  const info = providerRegistry.getProviderInfo(selectedProviderId);
  if (!info) {
    app.addMessage("system", `Unknown provider: ${selectedProviderId}`);
    return;
  }

  const discoveredCredential = getProviderCredential(selectedProviderId);

  if (discoveredCredential.kind === "native_oauth") {
    updateProviderConfig(selectedProviderId, { disabled: false });
    const providers = await refreshProviderState(true);
    if (providers.some((p) => p.id === selectedProviderId)) {
      app.addMessage("system", `Connected ${getNativeCliLabel(selectedProviderId)} using existing native login${discoveredCredential.source ? ` from ${discoveredCredential.source}` : ""}.`);
    } else {
      app.addMessage("system", `Found ${getNativeCliLabel(selectedProviderId)} login, but the native CLI is not available on PATH yet.`);
    }
    return;
  }

  if (selectedProviderId in LOCAL_PROVIDER_DEFAULTS) {
    const defaultBaseUrl = LOCAL_PROVIDER_DEFAULTS[selectedProviderId];
    const savedBaseUrl = providerRegistry.getSavedBaseUrl(selectedProviderId);
    const baseUrlOptions = savedBaseUrl && savedBaseUrl !== defaultBaseUrl
      ? ["use default", "use saved", "custom"]
      : ["use default", "custom"];
    const entered = (await app.showQuestion(`Base URL for ${info.name}`, baseUrlOptions))?.trim() ?? "";
    let baseUrl = defaultBaseUrl;
    if (isSkippedPromptAnswer(entered)) {
      app.addMessage("system", "Connect cancelled.");
      return;
    }
    if (entered === "use default") {
      baseUrl = defaultBaseUrl;
    } else if (entered === "use saved" && savedBaseUrl) {
      baseUrl = savedBaseUrl;
    } else if (entered === "custom") {
      const custom = (await app.showQuestion(`Enter ${info.name} base URL`, undefined)).trim();
      if (isSkippedPromptAnswer(custom)) {
        app.addMessage("system", "Connect cancelled.");
        return;
      }
      if (!isValidHttpBaseUrl(custom)) {
        app.addMessage("system", `Invalid base URL: ${custom}`);
        return;
      }
      baseUrl = custom;
    } else if (entered && entered !== defaultBaseUrl) {
      if (!isValidHttpBaseUrl(entered)) {
        app.addMessage("system", `Invalid base URL: ${entered}`);
        return;
      }
      baseUrl = entered;
    }
    updateProviderConfig(selectedProviderId, { baseUrl, disabled: false });
    const providers = await refreshProviderState(true);
    if (providers.some((p) => p.id === selectedProviderId)) {
      app.addMessage("system", `Connected ${info.name} at ${baseUrl}.`);
    } else {
      app.addMessage("system", `${info.name} saved at ${baseUrl}, but it is not responding yet.`);
    }
    return;
  }

  if (discoveredCredential.kind === "api_key") {
    updateProviderConfig(selectedProviderId, { disabled: false });
    await refreshProviderState(true);
    app.addMessage("system", `Connected ${info.name} using existing credentials${discoveredCredential.source ? ` from ${discoveredCredential.source}` : ""}.`);
    return;
  }

  const apiKey = (await app.showQuestion(`Paste ${info.name} API key`, undefined)).trim();
  if (isSkippedPromptAnswer(apiKey)) {
    app.addMessage("system", "Connect cancelled.");
    return;
  }
  updateProviderConfig(selectedProviderId, { apiKey, disabled: false });
  const providers = await refreshProviderState(true);
  if (providers.some((p) => p.id === selectedProviderId)) {
    app.addMessage("system", `Connected ${info.name}.`);
  } else {
    app.addMessage("system", `${info.name} credentials saved, but detection has not confirmed access yet.`);
  }
}
