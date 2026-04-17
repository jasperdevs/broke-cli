import { beforeEach, describe, expect, it, vi } from "vitest";

const configMocks = vi.hoisted(() => ({
  getProviderCredential: vi.fn(),
  getApiKey: vi.fn(),
  getBaseUrl: vi.fn(),
  spawnSync: vi.fn(),
  spawn: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../src/core/config.js", () => ({
  getBaseUrl: configMocks.getBaseUrl,
  getSettings: () => ({
    thinkingBudgets: {
      minimal: 1024,
      low: 4096,
      medium: 10240,
      high: 32768,
      xhigh: 65536,
    },
    disabledTools: [],
    disabledExtensions: [],
    autonomy: {
      allowNetwork: true,
      allowReadOutsideWorkspace: false,
      allowWriteOutsideWorkspace: false,
      allowShellOutsideWorkspace: false,
      allowDestructiveShell: false,
      additionalReadRoots: [],
      additionalWriteRoots: [],
    },
  }),
}));

vi.mock("../src/core/provider-credentials.js", () => ({
  getApiKey: configMocks.getApiKey,
  getProviderCredential: configMocks.getProviderCredential,
}));

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawnSync: configMocks.spawnSync,
    spawn: configMocks.spawn,
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
import { isIsolatedLinuxContainerRuntime, normalizeNativeUsage, resolveCodexSandboxMode, resolveNativeSpawnCommand, startNativeStream } from "../src/ai/native-stream.js";

describe("provider runtime selection", () => {
  beforeEach(() => {
    configMocks.getApiKey.mockReset();
    configMocks.getBaseUrl.mockReset();
    configMocks.getProviderCredential.mockReset();
    configMocks.spawnSync.mockReset();
    configMocks.spawn.mockReset();
    configMocks.existsSync.mockReset();
    configMocks.getProviderCredential.mockImplementation(() => ({ kind: "none" }));
    configMocks.getApiKey.mockImplementation((providerId: string) =>
      ["openai", "anthropic", "google", "mistral", "xai"].includes(providerId) ? "test-key" : undefined);
    configMocks.spawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin/mock\n", error: undefined });
    configMocks.existsSync.mockReturnValue(false);
  });

  it("does not accept native provider runtime selection", () => {
    configMocks.getProviderCredential.mockImplementation((providerId: string) => (
      providerId === "anthropic" ? { kind: "native_oauth", source: "claude-oauth" } : { kind: "none" }
    ));

    expect(shouldUseNativeProvider("anthropic")).toBe(false);
    expect(shouldUseNativeProvider("codex")).toBe(false);
    expect(() => createModel("codex")).toThrow("Unsupported provider: codex");
    expect(() => createModel("google-gemini-cli")).toThrow("Unsupported provider: google-gemini-cli");
  });

  it("creates SDK models only for the supported Vercel AI SDK providers", () => {
    expect(createModel("openai", "gpt-5.4-mini").runtime).toBe("sdk");
    expect(createModel("anthropic", "claude-sonnet-4-6").runtime).toBe("sdk");
    expect(createModel("google", "gemini-2.5-flash").runtime).toBe("sdk");
    expect(createModel("mistral", "mistral-small-latest").runtime).toBe("sdk");
    expect(createModel("xai", "grok-3-mini").runtime).toBe("sdk");
    expect(() => createModel("ollama")).toThrow("Unsupported provider: ollama");
    expect(() => createModel("openrouter")).toThrow("Unsupported provider: openrouter");
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

  it("launches Windows cmd shims through ComSpec for native streaming", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const resolved = resolveNativeSpawnCommand(
        "C:\\Users\\bunny\\AppData\\Roaming\\npm\\codex.cmd",
        ["exec", "--json", "-m", "gpt-5.4-mini", "-C", "C:\\Users\\bunny\\Downloads\\broke-cli"],
      );
      expect(resolved.command.toLowerCase()).toContain("cmd.exe");
      expect(resolved.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
      expect(resolved.args[3]).toBe("C:\\Users\\bunny\\AppData\\Roaming\\npm\\codex.cmd");
      expect(resolved.args).toContain("-m");
      expect(resolved.args).toContain("gpt-5.4-mini");
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });

  it("clamps wildly inflated native Codex input usage back to estimated prompt size", () => {
    const usage = normalizeNativeUsage({
      providerId: "codex",
      reported: { inputTokens: 80234, outputTokens: 247, cacheReadTokens: 0, cacheWriteTokens: 0 },
      estimatedInputTokens: 1342,
      estimatedOutputTokens: 19,
    });

    expect(usage.inputTokens).toBe(1342);
    expect(usage.outputTokens).toBe(247);
  });

  it("keeps plausible native Codex usage when it stays near the estimated prompt size", () => {
    const usage = normalizeNativeUsage({
      providerId: "codex",
      reported: { inputTokens: 1810, outputTokens: 55, cacheReadTokens: 0, cacheWriteTokens: 0 },
      estimatedInputTokens: 1342,
      estimatedOutputTokens: 20,
    });

    expect(usage.inputTokens).toBe(1810);
    expect(usage.outputTokens).toBe(55);
  });

  it("fails a native side question if Claude emits tool_use blocks", async () => {
    const stdoutHandlers: Record<string, (chunk: string) => void> = {};
    const processHandlers: Record<string, (code?: number) => void> = {};
    configMocks.spawn.mockReturnValue({
      stdout: { on: (event: string, handler: (chunk: string) => void) => { stdoutHandlers[event] = handler; } },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: (event: string, handler: (code?: number) => void) => { processHandlers[event] = handler; },
      kill: vi.fn(),
    });

    const onError = vi.fn();
    const onFinish = vi.fn();
    const pending = startNativeStream({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      system: "system",
      messages: [{ role: "user", content: "status?" }],
      denyToolUse: true,
    }, {
      onText: vi.fn(),
      onReasoning: vi.fn(),
      onFinish,
      onError,
    });

    stdoutHandlers.data?.(`${JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read" }],
      },
    })}\n`);
    processHandlers.close?.(0);

    await pending;
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Side question attempted to use Read"),
    }));
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("launches Claude native runs with scoped workspace permissions", async () => {
    const handlers: Record<string, (code?: number) => void> = {};
    const kill = vi.fn();
    configMocks.spawn.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: (event: string, handler: (code?: number) => void) => { handlers[event] = handler; },
      kill,
    });

    const controller = new AbortController();
    const pending = startNativeStream({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      system: "system",
      messages: [{ role: "user", content: "status?" }],
      abortSignal: controller.signal,
    }, {
      onText: vi.fn(),
      onReasoning: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
    });

    expect(configMocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["--permission-mode", "acceptEdits", "--add-dir", process.cwd()]),
      expect.any(Object),
    );

    controller.abort();
    await pending;
    expect(kill).toHaveBeenCalled();
  });

  it("launches Codex native runs with workspace-write sandboxing", async () => {
    const kill = vi.fn();
    configMocks.spawn.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: vi.fn(),
      kill,
    });

    const controller = new AbortController();
    const pending = startNativeStream({
      providerId: "codex",
      modelId: "gpt-5.4-mini",
      system: "system",
      messages: [{ role: "user", content: "status?" }],
      abortSignal: controller.signal,
    }, {
      onText: vi.fn(),
      onReasoning: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
    });

    expect(configMocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["--sandbox", "workspace-write", "--add-dir", process.cwd()]),
      expect.any(Object),
    );

    controller.abort();
    await pending;
    expect(kill).toHaveBeenCalled();
  });

  it("passes an output schema to Codex when minimal final output is enforced", async () => {
    const kill = vi.fn();
    configMocks.spawn.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: vi.fn(),
      kill,
    });

    const controller = new AbortController();
    const pending = startNativeStream({
      providerId: "codex",
      modelId: "gpt-5.4-mini",
      system: "system",
      messages: [{ role: "user", content: "fix it" }],
      abortSignal: controller.signal,
      structuredFinalResponse: { maxChars: 120 },
    }, {
      onText: vi.fn(),
      onReasoning: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
    });

    expect(configMocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["--output-schema", expect.stringContaining("codex-final-120.schema.json")]),
      expect.any(Object),
    );

    controller.abort();
    await pending;
    expect(kill).toHaveBeenCalled();
  });

  it("detects isolated Linux container runtimes from standard marker files", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });
    configMocks.existsSync.mockImplementation((path: string) => path === "/.dockerenv");

    try {
      expect(isIsolatedLinuxContainerRuntime()).toBe(true);
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });

  it("falls back to danger-full-access inside isolated Linux containers", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });
    configMocks.existsSync.mockImplementation((path: string) => path === "/.dockerenv");

    try {
      expect(resolveCodexSandboxMode({ denyToolUse: false })).toBe("danger-full-access");
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });

  it("keeps read-only Codex sandboxing for side questions even in containers", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });
    configMocks.existsSync.mockImplementation((path: string) => path === "/.dockerenv");

    try {
      expect(resolveCodexSandboxMode({ denyToolUse: true })).toBe("read-only");
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });
});
