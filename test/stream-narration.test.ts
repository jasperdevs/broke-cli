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

import { runModelTurn } from "../src/cli/turn-runner.js";

describe("stream narration suppression", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockClear();
  });

  it("suppresses obvious tool-intent narration before edit-tool work starts", async () => {
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
      getChatMessages: () => [{ role: "user", content: "make a file" }],
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
        yield { type: "text-delta", text: "The user asked me to create a file, so I will use writeFile." };
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
});
