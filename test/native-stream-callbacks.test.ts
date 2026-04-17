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

  it("surfaces Codex response output_item tool results through callbacks", async () => {
    const stdoutHandlers: Record<string, (chunk: string) => void> = {};
    const processHandlers: Record<string, (code?: number) => void> = {};
    configMocks.spawn.mockReturnValue({
      stdout: { on: (event: string, handler: (chunk: string) => void) => { stdoutHandlers[event] = handler; } },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: (event: string, handler: (code?: number) => void) => { processHandlers[event] = handler; },
      kill: vi.fn(),
    });

    const onToolResult = vi.fn();
    const onAfterToolCall = vi.fn();
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
      onToolResult,
      onAfterToolCall,
    });

    stdoutHandlers.data?.(`${JSON.stringify({
      type: "response.output_item.done",
      item: {
        type: "function_call_output",
        call_id: "call_result_1",
        name: "bash",
        output: "tests passed",
      },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({ type: "response.completed", response: { usage: {} } })}\n`);
    processHandlers.close?.(0);

    await pending;
    expect(onToolResult).toHaveBeenCalledWith("bash", "tests passed", "call_result_1");
    expect(onAfterToolCall).toHaveBeenCalledTimes(1);
  });

  it("surfaces archived Codex CLI response_item tool calls and outputs", async () => {
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
    const onAfterToolCall = vi.fn();
    const pending = startNativeStream({
      providerId: "codex",
      modelId: "gpt-5.4",
      system: "system",
      messages: [{ role: "user", content: "make a game" }],
    }, {
      onText: vi.fn(),
      onReasoning: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
      onToolCallStart,
      onToolCall,
      onToolResult,
      onAfterToolCall,
    });

    stdoutHandlers.data?.(`${JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        arguments: "{\"command\":\"New-Item -ItemType Directory snake-game\"}",
        call_id: "call_1",
      },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_1",
        output: "Exit code: 0\nCreated snake-game",
      },
    })}\n`);
    processHandlers.close?.(0);

    await pending;
    expect(onToolCallStart).toHaveBeenCalledWith("bash", "call_1");
    expect(onToolCall).toHaveBeenCalledWith("bash", { command: "New-Item -ItemType Directory snake-game" }, "call_1");
    expect(onToolResult).toHaveBeenCalledWith("bash", "Exit code: 0\nCreated snake-game", "call_1");
    expect(onAfterToolCall).toHaveBeenCalledTimes(1);
  });

  it("streams archived Codex CLI agent messages as reasoning and task completion as final text", async () => {
    const stdoutHandlers: Record<string, (chunk: string) => void> = {};
    const processHandlers: Record<string, (code?: number) => void> = {};
    configMocks.spawn.mockReturnValue({
      stdout: { on: (event: string, handler: (chunk: string) => void) => { stdoutHandlers[event] = handler; } },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: (event: string, handler: (code?: number) => void) => { processHandlers[event] = handler; },
      kill: vi.fn(),
    });

    const onText = vi.fn();
    const onReasoning = vi.fn();
    const onFinish = vi.fn();
    const pending = startNativeStream({
      providerId: "codex",
      modelId: "gpt-5.4",
      system: "system",
      messages: [{ role: "user", content: "make a game" }],
    }, {
      onText,
      onReasoning,
      onFinish,
      onError: vi.fn(),
    });

    stdoutHandlers.data?.(`${JSON.stringify({
      type: "event_msg",
      payload: { type: "agent_message", message: "I am creating the files now." },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "Created snake-game with a Three.js snake game." },
    })}\n`);
    processHandlers.close?.(0);

    await pending;
    expect(onReasoning).toHaveBeenCalledWith("I am creating the files now.\n");
    expect(onText).toHaveBeenCalledWith("Created snake-game with a Three.js snake game.");
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("surfaces current Codex command_execution and file_change items as tool activity", async () => {
    const stdoutHandlers: Record<string, (chunk: string) => void> = {};
    const processHandlers: Record<string, (code?: number) => void> = {};
    configMocks.spawn.mockReturnValue({
      stdout: { on: (event: string, handler: (chunk: string) => void) => { stdoutHandlers[event] = handler; } },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: (event: string, handler: (code?: number) => void) => { processHandlers[event] = handler; },
      kill: vi.fn(),
    });

    const onText = vi.fn();
    const onToolCallStart = vi.fn();
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const onAfterToolCall = vi.fn();
    const onFinish = vi.fn();
    const pending = startNativeStream({
      providerId: "codex",
      modelId: "gpt-5.4-mini",
      system: "system",
      messages: [{ role: "user", content: "create hello.txt" }],
    }, {
      onText,
      onReasoning: vi.fn(),
      onFinish,
      onError: vi.fn(),
      onToolCallStart,
      onToolCall,
      onToolResult,
      onAfterToolCall,
    });

    stdoutHandlers.data?.(`${JSON.stringify({
      type: "item.started",
      item: { id: "item_1", type: "command_execution", command: "pwsh -NoProfile -Command Get-Location", aggregated_output: "", exit_code: null, status: "in_progress" },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({
      type: "item.completed",
      item: { id: "item_1", type: "command_execution", command: "pwsh -NoProfile -Command Get-Location", aggregated_output: "C:\\repo\n", exit_code: 0, status: "completed" },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({
      type: "item.started",
      item: { id: "item_2", type: "file_change", changes: [{ path: "hello.txt", kind: "add" }], status: "in_progress" },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({
      type: "item.completed",
      item: { id: "item_2", type: "file_change", changes: [{ path: "hello.txt", kind: "add" }], status: "completed" },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({
      type: "item.completed",
      item: { id: "item_3", type: "agent_message", text: "Created hello.txt." },
    })}\n`);
    stdoutHandlers.data?.(`${JSON.stringify({ type: "turn.completed", usage: {} })}\n`);
    processHandlers.close?.(0);

    await pending;
    expect(onToolCallStart).toHaveBeenCalledWith("bash", "item_1");
    expect(onToolCall).toHaveBeenCalledWith("bash", { command: "pwsh -NoProfile -Command Get-Location" }, "item_1");
    expect(onToolResult).toHaveBeenCalledWith("bash", { success: true, output: "C:\\repo\n" }, "item_1");
    expect(onToolCallStart).toHaveBeenCalledWith("workspaceEdit", "item_2");
    expect(onToolCall).toHaveBeenCalledWith("workspaceEdit", { path: "hello.txt", changes: [{ path: "hello.txt", kind: "add" }] }, "item_2");
    expect(onToolResult).toHaveBeenCalledWith("workspaceEdit", { success: true, output: "add hello.txt" }, "item_2");
    expect(onAfterToolCall).toHaveBeenCalledTimes(2);
    expect(onText).toHaveBeenCalledWith("Created hello.txt.");
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("rejects current Codex command_execution items when native tool use is denied", async () => {
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
      providerId: "codex",
      modelId: "gpt-5.4-mini",
      system: "system",
      messages: [{ role: "user", content: "what changed?" }],
      denyToolUse: true,
    }, {
      onText: vi.fn(),
      onReasoning: vi.fn(),
      onFinish,
      onError,
    });

    stdoutHandlers.data?.(`${JSON.stringify({
      type: "item.started",
      item: { id: "item_1", type: "command_execution", command: "git status", aggregated_output: "", exit_code: null, status: "in_progress" },
    })}\n`);
    processHandlers.close?.(0);

    await pending;
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Side question attempted to use bash." }));
    expect(onFinish).not.toHaveBeenCalled();
  });
});
