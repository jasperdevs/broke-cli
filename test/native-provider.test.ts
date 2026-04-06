import { beforeEach, describe, expect, it, vi } from "vitest";

const configMocks = vi.hoisted(() => ({
  getProviderCredential: vi.fn(),
  getApiKey: vi.fn(),
  getBaseUrl: vi.fn(),
  spawnSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../src/core/config.js", () => ({
  getApiKey: configMocks.getApiKey,
  getBaseUrl: configMocks.getBaseUrl,
  getProviderCredential: configMocks.getProviderCredential,
}));

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawnSync: configMocks.spawnSync,
  };
});

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: configMocks.existsSync,
  };
});

import { createModel, shouldUseNativeProvider } from "../src/ai/providers.js";

describe("native provider runtime selection", () => {
  beforeEach(() => {
    configMocks.getApiKey.mockReset();
    configMocks.getBaseUrl.mockReset();
    configMocks.getProviderCredential.mockReset();
    configMocks.spawnSync.mockReset();
    configMocks.existsSync.mockReset();
    configMocks.getProviderCredential.mockImplementation(() => ({ kind: "none" }));
    configMocks.spawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin/mock\n", error: undefined });
    configMocks.existsSync.mockReturnValue(false);
  });

  it("uses Claude Code runtime when native Claude OAuth is present", () => {
    configMocks.getProviderCredential.mockImplementation((providerId: string) => (
      providerId === "anthropic" ? { kind: "native_oauth", source: "claude-oauth" } : { kind: "none" }
    ));

    expect(shouldUseNativeProvider("anthropic")).toBe(true);

    const model = createModel("anthropic", "claude-sonnet-4-6");
    expect(model.runtime).toBe("native-cli");
    expect(model.nativeCommand).toBe("claude");
    expect(model.provider.name).toBe("Claude Code");
  });

  it("uses Codex runtime when ChatGPT auth is present", () => {
    configMocks.getProviderCredential.mockImplementation((providerId: string) => (
      providerId === "codex" ? { kind: "native_oauth", source: "codex-chatgpt" } : { kind: "none" }
    ));

    expect(shouldUseNativeProvider("codex")).toBe(true);

    const model = createModel("codex", "gpt-5.4-mini");
    expect(model.runtime).toBe("native-cli");
    expect(model.nativeCommand).toBe("codex");
    expect(model.provider.id).toBe("codex");
  });

  it("does not select the native runtime when the CLI is missing", () => {
    configMocks.getProviderCredential.mockImplementation((providerId: string) => (
      providerId === "codex" ? { kind: "native_oauth", source: "codex-chatgpt" } : { kind: "none" }
    ));
    configMocks.spawnSync.mockReturnValue({ status: 1, stdout: "", error: undefined });

    expect(shouldUseNativeProvider("codex")).toBe(false);

    const model = createModel("codex", "gpt-5.4-mini");
    expect(model.runtime).toBe("sdk");
    expect(model.nativeCommand).toBeUndefined();
  });

  it("normalizes bare Windows shims to a runnable cmd path", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    configMocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: "C:\\Users\\bunny\\AppData\\Roaming\\npm\\codex\r\n",
      error: undefined,
    });
    configMocks.existsSync.mockImplementation((path: string) => path.endsWith(".cmd"));

    try {
      const { resolveNativeCommand } = await import("../src/ai/native-cli.js");
      expect(resolveNativeCommand("codex")).toBe("C:\\Users\\bunny\\AppData\\Roaming\\npm\\codex.cmd");
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });
});
