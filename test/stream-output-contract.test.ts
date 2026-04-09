import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamTextMock, stepCountIsMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  stepCountIsMock: vi.fn((count: number) => ({ count })),
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
    compaction: { keepRecentTokens: 24000 },
    images: { blockImages: false },
    autoCompact: false,
    enablePromptCaching: true,
    autoRoute: true,
    notifyOnResponse: false,
    enableThinking: false,
    thinkingLevel: "off",
    cavemanLevel: "ultra",
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
}));

vi.mock("../src/ai/router.js", () => ({
  routeMessage: () => "main",
}));

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
  COMPACTION_SUMMARY_PREFIX: "summary",
  compactMessages: async (messages: any[]) => messages,
  getTotalContextTokens: () => 1,
  splitCompactedMessages: (messages: any[]) => ({ summary: null, messages }),
}));

vi.mock("../src/core/context.js", () => ({
  buildSystemPrompt: () => "system",
  buildTaskExecutionAddendum: () => "",
  buildPromptCacheKey: () => "brokecli:test",
  resolveCavemanLevel: () => "auto",
}));

vi.mock("../src/core/turn-policy.js", () => ({
  resolveTurnPolicy: async () => ({
    archetype: "edit",
    allowedTools: ["readFile", "editFile", "writeFile"],
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

import { runModelTurn } from "../src/cli/turn-runner.js";

describe("stream output contract", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockClear();
  });

  it("drops leaked orchestration text before showing a casual answer", async () => {
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
      getChatMessages: () => [{ role: "user", content: "hey" }],
      addMessage: vi.fn(),
      addUsage: vi.fn(),
      recordTurn: vi.fn(),
      recordIdleCacheCliff: vi.fn(),
      replaceConversation: vi.fn(),
      recordCompaction: vi.fn(),
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages, nextTurn: vi.fn() }),
      getCwd: () => process.cwd(),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
    } as any;

    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "User wants brief, casual answer.\nInput: hey\nContext: None.\nAction: Answer simply, short.\n\nHey." };
      })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    await runModelTurn({
      app: app as any,
      session,
      text: "hey",
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

    expect(app.appendToLastMessage).toHaveBeenCalledWith("Hey.");
    expect(session.addMessage).toHaveBeenCalledWith("assistant", "Hey.");
    expect(app.appendToLastMessage).not.toHaveBeenCalledWith(expect.stringContaining("User wants"));
  });

  it("finishes tool turns with a short assistant response when tools ran but no text arrived", async () => {
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
      getChatMessages: () => [{ role: "user", content: "edit README.md" }],
      addMessage: vi.fn(),
      addUsage: vi.fn(),
      recordTurn: vi.fn(),
      recordToolResult: vi.fn(),
      recordRepoRead: vi.fn(),
      recordShellRecovery: vi.fn(),
      recordIdleCacheCliff: vi.fn(),
      replaceConversation: vi.fn(),
      recordCompaction: vi.fn(),
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages, nextTurn: vi.fn(), invalidateToolResults: vi.fn(), trackFileRead: vi.fn() }),
      getCwd: () => process.cwd(),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
    } as any;

    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "tool-input-start", toolName: "editFile" };
        yield { type: "tool-call", toolName: "editFile", input: { path: "README.md", old_string: "a", new_string: "b" } };
      })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    await runModelTurn({
      app: app as any,
      session,
      text: "edit README.md",
      activeModel: { provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: [] }, runtime: "sdk", model: {} as any, modelId: "gpt-5.4-mini" },
      currentModelId: "gpt-5.4-mini",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      systemPrompt: "system",
      buildTools: () => ({ editFile: {} }),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      lastActivityTime: Date.now(),
    });

    expect(app.appendToLastMessage).toHaveBeenCalledWith("Done.");
    expect(session.addMessage).toHaveBeenCalledWith("assistant", "Done.");
    expect(app.addMessage).not.toHaveBeenCalledWith("system", expect.stringContaining("No response from"));
  });
});
