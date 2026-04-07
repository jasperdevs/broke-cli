import { afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { runLoginFlow } from "../src/cli/login-flow.js";
import { OAUTH_PROVIDERS } from "../src/cli/oauth-providers.js";

vi.mock("../src/cli/oauth-login-support.js", () => ({
  runOAuthProviderLogin: vi.fn(async () => {}),
}));

vi.mock("../src/ai/native-cli.js", () => ({
  resolveNativeCommand: vi.fn((command: string) => `${command}.cmd`),
}));

vi.mock("../src/ai/native-stream.js", () => ({
  resolveNativeSpawnCommand: vi.fn((command: string, args: string[]) => ({ command, args })),
}));

const authPath = join(homedir(), ".brokecli", "auth.json");

afterEach(() => {
  rmSync(authPath, { force: true });
  vi.clearAllMocks();
});

describe("login flow", () => {
  it("shows the full Pi-style OAuth provider list in the expected order", async () => {
    const pickerCalls: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }> }> = [];
    const app = {
      setStatus: vi.fn(),
      addMessage() {},
      async showQuestion() { return "github.com"; },
      openItemPicker(title: string, items: Array<{ id: string; label: string; detail?: string }>, onSelect: (id: string) => void) {
        pickerCalls.push({ title, items });
        onSelect("github-copilot");
      },
    };

    await runLoginFlow({
      app,
      providerRegistry: {
        getConnectStatus: (providerId: string) => `${providerId} status`,
        getProviderInfo: () => undefined,
      } as any,
      refreshProviderState: async () => [{ id: "github-copilot" }] as any,
    });

    expect(pickerCalls).toHaveLength(1);
    expect(pickerCalls[0]?.title).toBe("Select provider to login:");
    expect(pickerCalls[0]?.items.map((item) => item.label)).toEqual(OAUTH_PROVIDERS.map((provider) => provider.label));
    expect(pickerCalls[0]?.items.map((item) => item.detail)).toEqual(OAUTH_PROVIDERS.map((provider) => `${provider.id} status`));
  });

  it("runs the existing codex CLI login path for codex", async () => {
    const app = {
      addMessage: vi.fn(),
      setStatus: vi.fn(),
      async showQuestion() { return ""; },
      openItemPicker() {},
      runExternalCommand: vi.fn(() => 0),
    };

    await runLoginFlow({
      providerId: "codex",
      app,
      providerRegistry: {
        getProviderInfo: () => ({ name: "Codex" }),
      } as any,
      refreshProviderState: async () => [{ id: "codex" }] as any,
    });

    expect(app.runExternalCommand).toHaveBeenCalledWith(
      "Login to ChatGPT Plus/Pro (Codex Subscription)",
      "codex",
      ["login"],
    );
    expect(app.addMessage).not.toHaveBeenCalled();
    expect(app.setStatus).toHaveBeenCalledWith("Logged in to Codex.");
  });
});
