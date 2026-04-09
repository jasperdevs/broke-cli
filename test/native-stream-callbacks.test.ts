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

import { startNativeStream } from "../src/ai/native-stream.js";

describe("native stream tool callbacks", () => {
  beforeEach(() => {
    configMocks.getApiKey.mockReset();
    configMocks.getBaseUrl.mockReset();
    configMocks.getProviderCredential.mockReset();
    configMocks.spawnSync.mockReset();
    configMocks.spawn.mockReset();
    configMocks.existsSync.mockReset();
    configMocks.getProviderCredential.mockImplementation(() => ({ kind: "none" }));
    configMocks.spawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin/mock\n", error: undefined });
    configMocks.existsSync.mockReturnValue(false);
  });

  it("surfaces Claude tool_use blocks through native stream callbacks", async () => {
    const stdoutHandlers: Record<string, (chunk: string) => void> = {};
    const processHandlers: Record<string, (code?: number) => void> = {};
    configMocks.spawn.mockReturnValue({
      stdout: { on: (event: string, handler: (chunk: string) => void) => { stdoutHandlers[event] = handler; } },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: (event: string, handler: (code?: number) => void) => { processHandlers[event] = handler; },
      kill: vi.fn(),
    });

    const onToolCallStart = vi.fn();
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const pending = startNativeStream({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      system: "system",
      messages: [{ role: "user", content: "status?" }],
    }, {
      onText: vi.fn(),
      onReasoning: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
      onToolCallStart,
      onToolCall,
      onToolResult,
      onAfterToolCall: vi.fn(),
    });

    stdoutHandlers.data?.(`${JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "README.md" } }],
      },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
      },
    })}\n`);
    processHandlers.close?.(0);

    await pending;
    expect(onToolCallStart).toHaveBeenCalledWith("Read", "toolu_1");
    expect(onToolCall).toHaveBeenCalledWith("Read", { file_path: "README.md" }, "toolu_1");
    expect(onToolResult).toHaveBeenCalledWith("Read", "ok", "toolu_1");
  });

  it("surfaces Codex native tool items through callbacks", async () => {
    const stdoutHandlers: Record<string, (chunk: string) => void> = {};
    const processHandlers: Record<string, (code?: number) => void> = {};
    configMocks.spawn.mockReturnValue({
      stdout: { on: (event: string, handler: (chunk: string) => void) => { stdoutHandlers[event] = handler; } },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: (event: string, handler: (code?: number) => void) => { processHandlers[event] = handler; },
      kill: vi.fn(),
    });

    const onToolCallStart = vi.fn();
    const onToolCall = vi.fn();
    const pending = startNativeStream({
      providerId: "codex",
      modelId: "gpt-5.4-mini",
      system: "system",
      messages: [{ role: "user", content: "status?" }],
    }, {
      onText: vi.fn(),
      onReasoning: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
      onToolCallStart,
      onToolCall,
    });

    stdoutHandlers.data?.(`${JSON.stringify({
      type: "item.completed",
      item: {
        type: "function_call",
        call_id: "call_1",
        name: "readFile",
        arguments: { path: "README.md" },
      },
    })}\n`);
    processHandlers.close?.(0);

    await pending;
    expect(onToolCallStart).toHaveBeenCalledWith("readFile", "call_1");
    expect(onToolCall).toHaveBeenCalledWith("readFile", { path: "README.md" }, "call_1");
  });

  it("surfaces Codex native tool calls before completion when response events stream args", async () => {
    const stdoutHandlers: Record<string, (chunk: string) => void> = {};
    const processHandlers: Record<string, (code?: number) => void> = {};
    configMocks.spawn.mockReturnValue({
      stdout: { on: (event: string, handler: (chunk: string) => void) => { stdoutHandlers[event] = handler; } },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: (event: string, handler: (code?: number) => void) => { processHandlers[event] = handler; },
      kill: vi.fn(),
    });

    const onToolCallStart = vi.fn();
    const onToolCall = vi.fn();
    const pending = startNativeStream({
      providerId: "codex",
      modelId: "gpt-5.4-mini",
      system: "system",
      messages: [{ role: "user", content: "make index" }],
    }, {
      onText: vi.fn(),
      onReasoning: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
      onToolCallStart,
      onToolCall,
    });

    stdoutHandlers.data?.(`${JSON.stringify({
      type: "response.output_item.added",
      item: { type: "function_call", call_id: "call_2", name: "writeFile", arguments: "" },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({
      type: "response.function_call_arguments.delta",
      call_id: "call_2",
      delta: "{\"path\":\"index.html\"",
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call_2",
      arguments: "{\"path\":\"index.html\",\"content\":\"<html></html>\"}",
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({ type: "response.completed", response: { usage: {} } })}\n`);
    processHandlers.close?.(0);

    await pending;
    expect(onToolCallStart).toHaveBeenCalledWith("writeFile", "call_2");
    expect(onToolCall).toHaveBeenCalledWith("writeFile", { path: "index.html" }, "call_2");
    expect(onToolCall).toHaveBeenCalledWith("writeFile", { path: "index.html", content: "<html></html>" }, "call_2");
  });
});
