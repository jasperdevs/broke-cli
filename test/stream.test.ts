import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamTextMock, stepCountIsMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  stepCountIsMock: vi.fn((count: number) => ({ count })),
}));

const { routeMessageMock } = vi.hoisted(() => ({
  routeMessageMock: vi.fn(() => "main"),
}));

vi.mock("ai", () => ({
  streamText: streamTextMock,
  stepCountIs: stepCountIsMock,
}));

vi.mock("../src/ai/cost.js", () => ({
  calculateCost: () => ({ inputTokens: 1, outputTokens: 1, cost: 0 }),
  getContextLimit: () => 128000,
}));

vi.mock("../src/ai/tokens.js", () => ({
  estimateConversationTokens: () => 1,
  estimateTextTokens: () => 1,
}));

vi.mock("../src/core/config.js", () => ({
  getModelContextLimitOverride: () => undefined,
  getSettings: () => ({
    thinkingBudgets: {},
    images: { blockImages: false },
    autoCompact: false,
    autoRoute: true,
    notifyOnResponse: false,
    enableThinking: false,
    thinkingLevel: "off",
    cavemanLevel: "auto",
    autoFixValidation: false,
  }),
}));

vi.mock("../src/ai/router.js", () => ({
  routeMessage: routeMessageMock,
}));

import { startStream } from "../src/ai/stream.js";
import { runModelTurn } from "../src/cli/turn-runner.js";

vi.mock("../src/cli/notify.js", () => ({
  sendResponseNotification: () => {},
}));

vi.mock("../src/cli/auto-validate.js", () => ({
  runValidationSuite: async () => null,
}));

vi.mock("../src/core/budget.js", () => ({
  checkBudget: () => ({ allowed: true }),
}));

vi.mock("../src/core/compact.js", () => ({
  compactMessages: async (messages: any[]) => messages,
  getTotalContextTokens: () => 1,
  splitCompactedMessages: (messages: any[]) => ({ summary: null, messages }),
}));

vi.mock("../src/core/context.js", () => ({
  buildSystemPrompt: () => "system",
  buildTaskExecutionAddendum: () => "",
  resolveCavemanLevel: () => "auto",
}));

vi.mock("../src/core/turn-policy.js", () => ({
  resolveTurnPolicy: async () => ({
    archetype: "edit",
    allowedTools: ["readFile", "writeFile"],
    maxToolSteps: 0,
    scaffold: "lane: main\nsteps: 1) read 2) edit\nverify: once",
    scaffoldSource: "builtin",
    preferSmallExecutor: false,
    promptProfile: "full",
    historyWindow: null,
  }),
  shouldPreferSmallExecutor: () => false,
}));

vi.mock("../src/tools/todo.js", () => ({
  clearTodo: () => {},
}));

describe("stream tool steps", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockClear();
    routeMessageMock.mockReset();
    routeMessageMock.mockReturnValue("main");
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {})(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });
  });

  it("allows at least one tool step plus one answer step", async () => {
    await startStream({
      model: {} as any,
      modelId: "test",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: {} as any,
      maxToolSteps: 1,
    }, {
      onText: () => {},
      onReasoning: () => {},
      onFinish: () => {},
      onError: () => {},
    });

    expect(stepCountIsMock).toHaveBeenCalledWith(2);
    expect(streamTextMock).toHaveBeenCalled();
  });

  it("suppresses plain planning narration before edit-tool work starts", async () => {
    const app = {
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn(),
      appendThinking: vi.fn(),
      setThinkingRequested: vi.fn(),
      getLastAssistantContent: vi.fn(() => ""),
      setStreaming: vi.fn(),
      setStreamTokens: vi.fn(),
      updateUsage: vi.fn(),
      setContextUsage: vi.fn(),
      setCompacting: vi.fn(),
      setStatus: vi.fn(),
      addToolCall: vi.fn(),
      updateToolCallArgs: vi.fn(),
      addToolResult: vi.fn(),
      onAbortRequest: vi.fn(),
      hasPendingMessages: vi.fn(() => false),
      flushPendingMessages: vi.fn(),
    };
    const session = {
      getTotalCost: () => 0,
      getChatMessages: () => [{ role: "user", content: "make file" }],
      addMessage: vi.fn(),
      addUsage: vi.fn(),
      recordTurn: vi.fn(),
      recordIdleCacheCliff: vi.fn(),
      replaceConversation: vi.fn(),
      recordCompaction: vi.fn(),
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages, nextTurn: vi.fn() }),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
    } as any;

    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Using frontend-design lane. First step: inspect repo." };
      })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    await runModelTurn({
      app: app as any,
      session,
      text: "make a file",
      activeModel: { provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: [] }, runtime: "sdk", model: {} as any, modelId: "gpt-5.4-mini" },
      currentModelId: "gpt-5.4-mini",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      systemPrompt: "system",
      buildTools: () => ({}),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      lastActivityTime: Date.now(),
    });

    expect(app.appendToLastMessage).not.toHaveBeenCalled();
  });

  it("streams ordinary assistant text immediately before tool activity starts", async () => {
    const app = {
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn(),
      appendThinking: vi.fn(),
      setThinkingRequested: vi.fn(),
      getLastAssistantContent: vi.fn(() => ""),
      setStreaming: vi.fn(),
      setStreamTokens: vi.fn(),
      updateUsage: vi.fn(),
      setContextUsage: vi.fn(),
      setCompacting: vi.fn(),
      setStatus: vi.fn(),
      addToolCall: vi.fn(),
      updateToolCallArgs: vi.fn(),
      addToolResult: vi.fn(),
      onAbortRequest: vi.fn(),
      hasPendingMessages: vi.fn(() => false),
      flushPendingMessages: vi.fn(),
    };
    const session = {
      getTotalCost: () => 0,
      getChatMessages: () => [{ role: "user", content: "make file" }],
      addMessage: vi.fn(),
      addUsage: vi.fn(),
      recordTurn: vi.fn(),
      recordIdleCacheCliff: vi.fn(),
      replaceConversation: vi.fn(),
      recordCompaction: vi.fn(),
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages, nextTurn: vi.fn() }),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
    } as any;

    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "I can update README.md after a quick read." };
        yield { type: "tool-input-start", toolName: "readFile" };
        yield { type: "tool-call", toolName: "readFile", input: { path: "README.md" } };
      })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    await runModelTurn({
      app: app as any,
      session,
      text: "make a file",
      activeModel: { provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: [] }, runtime: "sdk", model: {} as any, modelId: "gpt-5.4-mini" },
      currentModelId: "gpt-5.4-mini",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      systemPrompt: "system",
      buildTools: () => ({ readFile: {} }),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      lastActivityTime: Date.now(),
    });

    expect(app.appendToLastMessage).toHaveBeenCalledWith("I can update README.md after a quick read.");
    expect(app.addToolCall).toHaveBeenCalledWith("readFile", "...");
    expect(app.updateToolCallArgs).toHaveBeenCalledWith("readFile", "README.md", { path: "README.md" });
  });

  it("escalates a cheap empty turn to the main model once", async () => {
    routeMessageMock.mockReturnValue("small");
    let assistantContent = "";
    const app = {
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn((delta: string) => { assistantContent += delta; }),
      appendThinking: vi.fn(),
      setThinkingRequested: vi.fn(),
      getLastAssistantContent: vi.fn(() => assistantContent),
      rollbackLastAssistantMessage: vi.fn(() => { assistantContent = ""; }),
      setStreaming: vi.fn(),
      setStreamTokens: vi.fn(),
      updateUsage: vi.fn(),
      setContextUsage: vi.fn(),
      setCompacting: vi.fn(),
      setStatus: vi.fn(),
      addToolCall: vi.fn(),
      updateToolCallArgs: vi.fn(),
      addToolResult: vi.fn(),
      onAbortRequest: vi.fn(),
      hasPendingMessages: vi.fn(() => false),
      flushPendingMessages: vi.fn(),
    };
    const session = {
      getTotalCost: () => 0,
      getChatMessages: () => [{ role: "user", content: "hey" }],
      addMessage: vi.fn(),
      addUsage: vi.fn(),
      recordTurn: vi.fn(),
      recordIdleCacheCliff: vi.fn(),
      replaceConversation: vi.fn(),
      recordCompaction: vi.fn(),
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages, nextTurn: vi.fn() }),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
    } as any;

    streamTextMock
      .mockReturnValueOnce({
        fullStream: (async function* () {})(),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      })
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield { type: "text-delta", text: "real answer" };
        })(),
        usage: Promise.resolve({ inputTokens: 2, outputTokens: 3 }),
      });

    await runModelTurn({
      app: app as any,
      session,
      text: "hey",
      activeModel: { provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: [] }, runtime: "sdk", model: {} as any, modelId: "gpt-5.4-mini" },
      currentModelId: "gpt-5.4-mini",
      smallModel: { provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5-mini", models: [] }, runtime: "sdk", model: {} as any, modelId: "gpt-5-mini" },
      smallModelId: "gpt-5-mini",
      currentMode: "build",
      systemPrompt: "system",
      buildTools: () => ({}),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      lastActivityTime: Date.now(),
    });

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(app.setStatus).toHaveBeenCalledWith("small model empty - retrying main");
    expect(session.addMessage).toHaveBeenCalledWith("assistant", "real answer");
    expect(app.addMessage).not.toHaveBeenCalledWith("system", "No response from model. Try again or switch models with /model.");
  });

  it("retries edit turns when a local sdk model claims success without using tools", async () => {
    let assistantContent = "";
    const app = {
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn((delta: string) => { assistantContent += delta; }),
      appendThinking: vi.fn(),
      setThinkingRequested: vi.fn(),
      getLastAssistantContent: vi.fn(() => assistantContent),
      rollbackLastAssistantMessage: vi.fn(() => { assistantContent = ""; }),
      setStreaming: vi.fn(),
      setStreamTokens: vi.fn(),
      updateUsage: vi.fn(),
      setContextUsage: vi.fn(),
      setCompacting: vi.fn(),
      setStatus: vi.fn(),
      addToolCall: vi.fn(),
      updateToolCallArgs: vi.fn(),
      addToolResult: vi.fn(),
      onAbortRequest: vi.fn(),
      hasPendingMessages: vi.fn(() => false),
      flushPendingMessages: vi.fn(),
    };
    const session = {
      getTotalCost: () => 0,
      getChatMessages: () => [{ role: "user", content: "make a index.html file thats cool" }],
      addMessage: vi.fn(),
      addUsage: vi.fn(),
      recordTurn: vi.fn(),
      recordToolResult: vi.fn(),
      recordShellRecovery: vi.fn(),
      recordIdleCacheCliff: vi.fn(),
      replaceConversation: vi.fn(),
      recordCompaction: vi.fn(),
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages, nextTurn: vi.fn(), trackFileRead: vi.fn() }),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
      getName: () => "Existing Session",
    } as any;

    streamTextMock
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield { type: "text-delta", text: "Added index.html with a modern, dark-themed landing page. Commit/push now." };
        })(),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      })
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield { type: "tool-input-start", toolName: "writeFile" };
          yield { type: "tool-call", toolName: "writeFile", input: { path: "index.html", content: "<html></html>" } };
          yield { type: "tool-result", toolName: "writeFile", output: { success: true } } as any;
          yield { type: "text-delta", text: "Created index.html." };
        })(),
        usage: Promise.resolve({ inputTokens: 2, outputTokens: 3 }),
      });

    await runModelTurn({
      app: app as any,
      session,
      text: "make a index.html file thats cool",
      activeModel: { provider: { id: "llamacpp", name: "llama.cpp", defaultModel: "default", models: ["default"] }, runtime: "sdk", model: {} as any, modelId: "default" },
      currentModelId: "default",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      systemPrompt: "system",
      buildTools: () => ({ writeFile: {} }),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      lastActivityTime: Date.now(),
    });

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(app.rollbackLastAssistantMessage).toHaveBeenCalled();
    expect(app.setStatus).toHaveBeenCalledWith("model answered without acting - retrying with tool requirement");
    expect(app.addToolCall).toHaveBeenCalledWith("writeFile", "...");
    expect(session.addMessage).toHaveBeenCalledWith("assistant", "Created index.html.");
    expect(session.addMessage).not.toHaveBeenCalledWith("assistant", "Added index.html with a modern, dark-themed landing page. Commit/push now.");
  });

  it("does not reuse the previous assistant turn when a new turn emits no text", async () => {
    const app = {
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn(),
      appendThinking: vi.fn(),
      setThinkingRequested: vi.fn(),
      getLastAssistantContent: vi.fn(() => "old answer"),
      rollbackLastAssistantMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamTokens: vi.fn(),
      updateUsage: vi.fn(),
      setContextUsage: vi.fn(),
      setCompacting: vi.fn(),
      setStatus: vi.fn(),
      addToolCall: vi.fn(),
      updateToolCallArgs: vi.fn(),
      addToolResult: vi.fn(),
      onAbortRequest: vi.fn(),
      hasPendingMessages: vi.fn(() => false),
      flushPendingMessages: vi.fn(),
    };
    const session = {
      getTotalCost: () => 0,
      getChatMessages: () => [{ role: "user", content: "hey" }, { role: "assistant", content: "old answer" }],
      addMessage: vi.fn(),
      addUsage: vi.fn(),
      recordTurn: vi.fn(),
      recordIdleCacheCliff: vi.fn(),
      replaceConversation: vi.fn(),
      recordCompaction: vi.fn(),
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages, nextTurn: vi.fn() }),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
      getName: () => "Existing Session",
    } as any;

    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () {})(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    await runModelTurn({
      app: app as any,
      session,
      text: "what sup",
      activeModel: { provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: [] }, runtime: "sdk", model: {} as any, modelId: "gpt-5.4-mini" },
      currentModelId: "gpt-5.4-mini",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      systemPrompt: "system",
      buildTools: () => ({}),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      lastActivityTime: Date.now(),
    });

    expect(session.addMessage).not.toHaveBeenCalledWith("assistant", "old answer");
    expect(session.addMessage).toHaveBeenCalledWith("assistant", "[empty response]");
  });
});
