import { describe, expect, it, vi } from "vitest";

const { startNativeStreamMock, startGoogleCloudCodeStreamMock } = vi.hoisted(() => ({
  startNativeStreamMock: vi.fn(),
  startGoogleCloudCodeStreamMock: vi.fn(),
}));

vi.mock("../src/ai/native-stream.js", async () => {
  const actual = await vi.importActual<typeof import("../src/ai/native-stream.js")>("../src/ai/native-stream.js");
  return {
    ...actual,
    startNativeStream: startNativeStreamMock,
  };
});

vi.mock("../src/ai/google-cloud-code-stream.js", () => ({
  startGoogleCloudCodeStream: startGoogleCloudCodeStreamMock,
}));

vi.mock("../src/core/config.js", async () => {
  const actual = await vi.importActual<typeof import("../src/core/config.js")>("../src/core/config.js");
  return {
    ...actual,
    getSettings: () => ({
      thinkingBudgets: {},
      compaction: { keepRecentTokens: 24000 },
      images: { blockImages: false },
      autoCompact: false,
      enablePromptCaching: true,
      autoRoute: false,
      notifyOnResponse: false,
      enableThinking: true,
      thinkingLevel: "low",
      cavemanLevel: "off",
      memoizeToolResults: true,
      modelGeneratedSessionNames: false,
      autoFixValidation: false,
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
  };
});

vi.mock("../src/core/compact.js", async () => {
  const actual = await vi.importActual<typeof import("../src/core/compact.js")>("../src/core/compact.js");
  return {
    ...actual,
    getTotalContextTokens: () => 1,
  };
});

vi.mock("../src/ai/tokens.js", async () => {
  const actual = await vi.importActual<typeof import("../src/ai/tokens.js")>("../src/ai/tokens.js");
  return {
    ...actual,
    estimateTextTokens: () => 1,
  };
});

vi.mock("../src/cli/notify.js", () => ({
  sendResponseNotification: () => {},
}));

import { executeTurn } from "../src/cli/turn-execution.js";
import { Session } from "../src/core/session.js";

describe("native turn runner integration", () => {
  beforeEach(() => {
    startNativeStreamMock.mockReset();
    startGoogleCloudCodeStreamMock.mockReset();
  });

  it("persists native Codex tools, thinking, and final text through the turn runner", async () => {
    const appendedText: string[] = [];
    const appendedThinking: string[] = [];
    const app = {
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn((delta: string) => appendedText.push(delta)),
      replaceLastAssistantMessage: vi.fn(),
      appendThinking: vi.fn((delta: string) => appendedThinking.push(delta)),
      setThinkingRequested: vi.fn(),
      getLastAssistantContent: vi.fn(() => appendedText.join("")),
      setStreaming: vi.fn(),
      setStreamTokens: vi.fn(),
      updateUsage: vi.fn(),
      setContextUsage: vi.fn(),
      setStatus: vi.fn(),
      addToolCall: vi.fn(),
      updateToolCallArgs: vi.fn(),
      addToolResult: vi.fn(),
      onAbortRequest: vi.fn(),
      hasPendingMessages: vi.fn(() => false),
      flushPendingMessages: vi.fn(),
      rollbackLastAssistantMessage: vi.fn(),
    };
    const session = new Session(`native-turn-${Date.now()}`);
    session.addMessage("user", "make a folder and a simple Three.js snake game");

    startNativeStreamMock.mockImplementationOnce(async (_opts, callbacks) => {
      callbacks.onReasoning("Creating the project files.\n");
      callbacks.onToolCallStart?.("bash", "call_1");
      callbacks.onToolCall?.("bash", { command: "mkdir snake-game" }, "call_1");
      callbacks.onToolResult?.("bash", { success: true, output: "created snake-game" }, "call_1");
      callbacks.onAfterToolCall?.();
      callbacks.onText("Created snake-game with a simple Three.js snake game.");
      callbacks.onFinish({ inputTokens: 10, outputTokens: 4, cost: 0 });
    });

    const result = await executeTurn({
      app: app as any,
      session,
      text: "make a folder and a simple Three.js snake game",
      activeModel: {
        provider: { id: "codex", name: "Codex", defaultModel: "gpt-5.4", models: ["gpt-5.4"] },
        runtime: "native-cli",
        modelId: "gpt-5.4",
        nativeCommand: "codex",
      },
      currentModelId: "gpt-5.4",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      policy: {
        archetype: "edit",
        allowedTools: ["bash"],
        maxToolSteps: 1,
        scaffold: "create the requested files",
        scaffoldSource: "builtin",
        preferSmallExecutor: false,
        promptProfile: "full",
        historyWindow: null,
      },
      effectiveImages: undefined,
      buildTools: () => ({}),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      contextLimit: 128000,
      activeSystemPrompt: "system",
      optimizeMessages: (messages) => messages,
    });

    expect(startNativeStreamMock).toHaveBeenCalledTimes(1);
    expect(app.addToolCall).toHaveBeenCalledWith("bash", "...", undefined, "call_1");
    expect(app.updateToolCallArgs).toHaveBeenCalledWith("bash", "mkdir snake-game", { command: "mkdir snake-game" }, "call_1");
    expect(app.addToolResult).toHaveBeenCalledWith("bash", "ok", false, "created snake-game", "call_1");
    expect(app.appendThinking).toHaveBeenCalledWith("Creating the project files.\n");
    expect(app.appendToLastMessage).toHaveBeenCalledWith("Created snake-game with a simple Three.js snake game.");
    expect(session.getMessages().at(-1)).toMatchObject({
      role: "assistant",
      content: "Created snake-game with a simple Three.js snake game.",
    });
    expect(result.toolActivity).toBe(true);
    expect(result.completion).toBe("success");
  });

  it("shows held edit-turn final text for OAuth stream runtimes without native tool events", async () => {
    const appendedText: string[] = [];
    const app = {
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn((delta: string) => appendedText.push(delta)),
      replaceLastAssistantMessage: vi.fn(),
      appendThinking: vi.fn(),
      setThinkingRequested: vi.fn(),
      getLastAssistantContent: vi.fn(() => appendedText.join("")),
      setStreaming: vi.fn(),
      setStreamTokens: vi.fn(),
      updateUsage: vi.fn(),
      setContextUsage: vi.fn(),
      setStatus: vi.fn(),
      addToolCall: vi.fn(),
      updateToolCallArgs: vi.fn(),
      addToolResult: vi.fn(),
      onAbortRequest: vi.fn(),
      hasPendingMessages: vi.fn(() => false),
      flushPendingMessages: vi.fn(),
      rollbackLastAssistantMessage: vi.fn(),
    };
    const session = new Session(`oauth-turn-${Date.now()}`);
    session.addMessage("user", "make a landing page");

    startGoogleCloudCodeStreamMock.mockImplementationOnce(async (_opts, callbacks) => {
      callbacks.onText("Created the landing page in index.html.");
      callbacks.onFinish({ inputTokens: 12, outputTokens: 6, cost: 0 });
    });

    const result = await executeTurn({
      app: app as any,
      session,
      text: "make a landing page",
      activeModel: {
        provider: { id: "google-gemini-cli", name: "Google Cloud Code Assist", defaultModel: "gemini-2.5-pro", models: ["gemini-2.5-pro"] },
        runtime: "oauth-stream",
        modelId: "gemini-2.5-pro",
      },
      currentModelId: "gemini-2.5-pro",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      policy: {
        archetype: "edit",
        allowedTools: ["writeFile", "editFile"],
        maxToolSteps: 1,
        scaffold: "create the requested files",
        scaffoldSource: "builtin",
        preferSmallExecutor: false,
        promptProfile: "full",
        historyWindow: null,
      },
      effectiveImages: undefined,
      buildTools: () => ({}),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      contextLimit: 128000,
      activeSystemPrompt: "system",
      optimizeMessages: (messages) => messages,
    });

    expect(startGoogleCloudCodeStreamMock).toHaveBeenCalledTimes(1);
    expect(app.appendToLastMessage).toHaveBeenCalledWith("Created the landing page in index.html.");
    expect(session.getMessages().at(-1)).toMatchObject({
      role: "assistant",
      content: "Created the landing page in index.html.",
    });
    expect(result.completion).toBe("success");
  });
});
