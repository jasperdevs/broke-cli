import { spawnSync } from "child_process";
import { resolveNativeCommand } from "../ai/native-cli.js";
import { resolveNativeSpawnCommand } from "../ai/native-stream.js";
import type { DetectedProvider } from "../ai/detect.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import { runOAuthProviderLogin } from "./oauth-login-support.js";
import { OAUTH_PROVIDERS, getOAuthProviderSpec } from "./oauth-providers.js";
import type { PickerItem } from "../ui-contracts.js";

interface LoginFlowApp {
  showQuestion(prompt: string, options?: string[]): Promise<string>;
  openItemPicker(title: string, items: PickerItem[], onSelect: (id: string) => void, options?: { kind?: "login" }): void;
  runExternalCommand?: (title: string, command: string, args: string[]) => number;
  setStatus?(message: string): void;
  clearStatus?(): void;
}

function setLoginStatus(app: LoginFlowApp, message: string): void {
  app.setStatus?.(message);
}

function runNativeLoginCommand(commandName: string, args: string[]): number {
  const resolved = resolveNativeCommand(commandName);
  if (!resolved) return 1;
  const spawnTarget = resolveNativeSpawnCommand(resolved, args);
  const result = spawnSync(spawnTarget.command, spawnTarget.args, {
    stdio: "inherit",
  });
  if (typeof result.status === "number") return result.status;
  return result.error ? 1 : 0;
}

export async function runLoginFlow(options: {
  providerId?: string;
  app: LoginFlowApp;
  providerRegistry: ProviderRegistry;
  refreshProviderState: (force?: boolean) => Promise<DetectedProvider[]>;
}): Promise<void> {
  const { providerId, app, providerRegistry, refreshProviderState } = options;

  const selectedProviderId = providerId ?? await new Promise<string>((resolve) => {
    const items = OAUTH_PROVIDERS.map((provider) => ({
      id: provider.id,
      label: provider.label,
      detail: providerRegistry.getConnectStatus(provider.id),
    }));
    app.openItemPicker("Select provider to login:", items, resolve, { kind: "login" });
  });

  const provider = getOAuthProviderSpec(selectedProviderId);
  if (!provider) {
    setLoginStatus(app, `Unknown OAuth provider: ${selectedProviderId}`);
    return;
  }

  if (provider.kind === "external-cli") {
    if (!provider.command || !provider.args || !resolveNativeCommand(provider.command)) {
      setLoginStatus(app, `${provider.label} requires the ${provider.command} CLI on PATH.`);
      return;
    }

    const exitCode = app.runExternalCommand
      ? app.runExternalCommand(`Login to ${provider.label}`, provider.command, provider.args)
      : runNativeLoginCommand(provider.command, provider.args);
    const providers = await refreshProviderState(true);
    if (exitCode === 0 && providers.some((entry) => entry.id === provider.id)) {
      const providerName = providerRegistry.getProviderInfo(provider.id)?.name ?? provider.label;
      setLoginStatus(app, `Logged in to ${providerName}.`);
      return;
    }
    setLoginStatus(app, exitCode === 0
      ? `${provider.label} login finished, but credentials were not detected yet.`
      : `${provider.label} login failed or was cancelled.`);
    return;
  }

  if (provider.kind === "github-cli" && !resolveNativeCommand(provider.command ?? "gh")) {
    setLoginStatus(app, "GitHub Copilot login requires the gh CLI on PATH.");
    return;
  }

  try {
    await runOAuthProviderLogin({
      app,
      providerId: provider.id as "github-copilot" | "google-gemini-cli" | "google-antigravity",
      label: provider.label,
    });
  } catch (error) {
    setLoginStatus(app, `${provider.label} login failed: ${(error as Error).message}`);
    return;
  }

  const providers = await refreshProviderState(true);
  if (providers.some((entry) => entry.id === provider.id)) {
    const providerName = providerRegistry.getProviderInfo(provider.id)?.name ?? provider.label;
    setLoginStatus(app, `Logged in to ${providerName}.`);
    return;
  }

  setLoginStatus(app, `${provider.label} login finished, but credentials were not detected yet.`);
}
