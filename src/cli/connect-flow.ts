import type { DetectedProvider } from "../ai/detect.js";
import { updateProviderConfig } from "../core/config.js";
import { getProviderCredential } from "../core/provider-credentials.js";
import { LOCAL_PROVIDER_DEFAULTS, type ProviderRegistry } from "../ai/provider-registry.js";
import type { PickerItem } from "../ui-contracts.js";

interface ConnectFlowApp {
  addMessage(role: "user" | "assistant" | "system", content: string): void;
  setStatus?(message: string): void;
  showQuestion(prompt: string, options?: string[]): Promise<string>;
  openItemPicker(
    title: string,
    items: PickerItem[],
    onSelect: (id: string) => void,
    options?: { kind?: "connect" },
  ): void;
}

const CONNECT_PROVIDER_ORDER = [
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

function reportConnectStatus(app: ConnectFlowApp, message: string): void {
  if (app.setStatus) app.setStatus(message);
  else app.addMessage("system", message);
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
    app.openItemPicker("Connect Provider", items, resolve, { kind: "connect" });
  });

  const info = providerRegistry.getProviderInfo(selectedProviderId);
  if (!info) {
    reportConnectStatus(app, `Unknown provider: ${selectedProviderId}`);
    return;
  }

  const discoveredCredential = getProviderCredential(selectedProviderId);

  if (discoveredCredential.kind === "native_oauth") {
    updateProviderConfig(selectedProviderId, { disabled: false });
    const providers = await refreshProviderState(true);
    if (providers.some((p) => p.id === selectedProviderId)) {
      reportConnectStatus(app, `Connected ${getNativeCliLabel(selectedProviderId)} using existing native login${discoveredCredential.source ? ` from ${discoveredCredential.source}` : ""}.`);
    } else {
      reportConnectStatus(app, `Found ${getNativeCliLabel(selectedProviderId)} login, but the native CLI is not available on PATH yet.`);
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
      reportConnectStatus(app, "Connect cancelled.");
      return;
    }
    if (entered === "use default") {
      baseUrl = defaultBaseUrl;
    } else if (entered === "use saved" && savedBaseUrl) {
      baseUrl = savedBaseUrl;
    } else if (entered === "custom") {
      const custom = (await app.showQuestion(`Enter ${info.name} base URL`, undefined)).trim();
      if (isSkippedPromptAnswer(custom)) {
        reportConnectStatus(app, "Connect cancelled.");
        return;
      }
      if (!isValidHttpBaseUrl(custom)) {
        reportConnectStatus(app, `Invalid base URL: ${custom}`);
        return;
      }
      baseUrl = custom;
    } else if (entered && entered !== defaultBaseUrl) {
      if (!isValidHttpBaseUrl(entered)) {
        reportConnectStatus(app, `Invalid base URL: ${entered}`);
        return;
      }
      baseUrl = entered;
    }
    updateProviderConfig(selectedProviderId, { baseUrl, disabled: false });
    const providers = await refreshProviderState(true);
    if (providers.some((p) => p.id === selectedProviderId)) {
      reportConnectStatus(app, `Connected ${info.name} at ${baseUrl}.`);
    } else {
      reportConnectStatus(app, `${info.name} saved at ${baseUrl}, but it is not responding yet.`);
    }
    return;
  }

  if (discoveredCredential.kind === "api_key") {
    updateProviderConfig(selectedProviderId, { disabled: false });
    await refreshProviderState(true);
    reportConnectStatus(app, `Connected ${info.name} using existing credentials${discoveredCredential.source ? ` from ${discoveredCredential.source}` : ""}.`);
    return;
  }

  const apiKey = (await app.showQuestion(`Paste ${info.name} API key`, undefined)).trim();
  if (isSkippedPromptAnswer(apiKey)) {
    reportConnectStatus(app, "Connect cancelled.");
    return;
  }
  updateProviderConfig(selectedProviderId, { apiKey, disabled: false });
  const providers = await refreshProviderState(true);
  if (providers.some((p) => p.id === selectedProviderId)) {
    reportConnectStatus(app, `Connected ${info.name}.`);
  } else {
    reportConnectStatus(app, `${info.name} credentials saved, but detection has not confirmed access yet.`);
  }
}
