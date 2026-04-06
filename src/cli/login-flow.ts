import { spawnSync } from "child_process";
import { resolveNativeCommand } from "../ai/native-cli.js";
import { resolveNativeSpawnCommand } from "../ai/native-stream.js";
import type { DetectedProvider } from "../ai/detect.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";

interface LoginFlowItem {
  id: string;
  label: string;
}

interface LoginFlowApp {
  addMessage(role: "user" | "assistant" | "system", content: string): void;
  openItemPicker(title: string, items: LoginFlowItem[], onSelect: (id: string) => void, options?: { kind?: "login" }): void;
  runExternalCommand?: (title: string, command: string, args: string[]) => number;
}

interface OAuthProviderSpec {
  id: string;
  label: string;
  command: string;
  args: string[];
}

const OAUTH_PROVIDERS: OAuthProviderSpec[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude Pro/Max)",
    command: "claude",
    args: ["auth", "login"],
  },
  {
    id: "codex",
    label: "ChatGPT Plus/Pro (Codex Subscription)",
    command: "codex",
    args: ["login"],
  },
];

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
    const items = OAUTH_PROVIDERS
      .filter((provider) => !!resolveNativeCommand(provider.command))
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
      }));
    app.openItemPicker("Select provider to login:", items, resolve, { kind: "login" });
  });

  const provider = OAUTH_PROVIDERS.find((entry) => entry.id === selectedProviderId);
  if (!provider) {
    app.addMessage("system", `Unknown OAuth provider: ${selectedProviderId}`);
    return;
  }

  if (!resolveNativeCommand(provider.command)) {
    app.addMessage("system", `${provider.label} requires the ${provider.command} CLI on PATH.`);
    return;
  }

  const exitCode = app.runExternalCommand
    ? app.runExternalCommand(`Login to ${provider.label}`, provider.command, provider.args)
    : runNativeLoginCommand(provider.command, provider.args);

  const providers = await refreshProviderState(true);
  if (exitCode === 0 && providers.some((entry) => entry.id === provider.id)) {
    const providerName = providerRegistry.getProviderInfo(provider.id)?.name ?? provider.label;
    app.addMessage("system", `Logged in to ${providerName}.`);
    return;
  }

  if (exitCode === 0) {
    app.addMessage("system", `${provider.label} login finished, but credentials were not detected yet.`);
    return;
  }

  app.addMessage("system", `${provider.label} login failed or was cancelled.`);
}
