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

vi.mock("../src/core/budget.js", () => ({
  checkBudget: () => ({ allowed: true }),
}));

vi.mock("../src/core/context.js", () => ({
  buildSystemPrompt: () => "system",
  buildTaskExecutionAddendum: () => "",
  buildPromptCacheKey: () => "brokecli:test",
  resolveCavemanLevel: () => "auto",
}));

vi.mock("../src/core/compact.js", () => ({
  COMPACTION_SUMMARY_PREFIX: "The conversation history before this point was compacted into the following summary:\n\n<summary>\n",
  compactMessages: async (messages: any[]) => messages,
  getTotalContextTokens: () => 1,
  splitCompactedMessages: (messages: any[]) => ({ summary: null, messages }),
}));

vi.mock("../src/core/turn-policy.js", () => ({
  resolveTurnPolicy: async () => ({
    archetype: "edit",
    allowedTools: ["writeFile"],
    maxToolSteps: 0,
    scaffold: "lane: main\nsteps: 1) write\nverify: once",
    scaffoldSource: "builtin",
    preferSmallExecutor: false,
    promptProfile: "edit",
    historyWindow: null,
  }),
  shouldPreferSmallExecutor: () => false,
}));

vi.mock("../src/cli/notify.js", () => ({
  sendResponseNotification: () => {},
}));

vi.mock("../src/cli/auto-validate.js", () => ({
  runValidationSuite: () => ({ attempted: false, failed: false, report: "" }),
}));

vi.mock("../src/tools/todo.js", () => ({
  clearTodo: () => {},
}));

import { runModelTurn } from "../src/cli/turn-runner.js";

describe("raw tool payload fallback", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockClear();
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {})(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });
  });

  it("executes tool-like assistant text from weak local models instead of leaving it in chat", async () => {
    let assistantContent = "";
    const app = {
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn((delta: string) => { assistantContent += delta; }),
      appendThinking: vi.fn(),
      setThinkingRequested: vi.fn(),
      getLastAssistantContent: vi.fn(() => assistantContent),
      replaceLastAssistantMessage: vi.fn(),
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
      getChatMessages: () => [{ role: "user", content: "make raw-local-test.html" }],
      addMessage: vi.fn(),
      addUsage: vi.fn(),
      recordTurn: vi.fn(),
      recordToolResult: vi.fn(),
      recordRepoRead: vi.fn(),
      recordRepoEdit: vi.fn(),
      recordIdleCacheCliff: vi.fn(),
      replaceConversation: vi.fn(),
      recordCompaction: vi.fn(),
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages, nextTurn: vi.fn(), trackFileRead: vi.fn() }),
      getCwd: () => process.cwd(),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
    } as any;

    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "writeFile{content:\"<!DOCTYPE html>\"}" };
      })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    await runModelTurn({
      app: app as any,
      session,
      text: "make raw-local-test.html",
      activeModel: { provider: { id: "llamacpp", name: "llama.cpp", defaultModel: "default", models: ["default"] }, runtime: "sdk", model: {} as any, modelId: "default" },
      currentModelId: "default",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      systemPrompt: "system",
      buildTools: () => ({
        writeFile: {
          execute: vi.fn(async (args: Record<string, unknown>) => ({ success: true, path: args.path, content: args.content })),
        },
      }),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      lastActivityTime: Date.now(),
    });

    expect(app.addToolCall).toHaveBeenCalledWith("writeFile", "...");
    expect(app.updateToolCallArgs).toHaveBeenCalledWith("writeFile", "raw-local-test.html", expect.objectContaining({ path: "raw-local-test.html" }));
    expect(app.addToolResult).toHaveBeenCalledWith("writeFile", "ok", false, "1 line · 15 bytes written");
    expect(session.addMessage).toHaveBeenCalledWith("assistant", "raw-local-test.html created.");
  });

  it("keeps raw-tool fallback cancellable after the stream finishes", async () => {
    let assistantContent = "";
    let abortHandler: (() => void) | undefined;
    const app = {
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn((delta: string) => { assistantContent += delta; }),
      appendThinking: vi.fn(),
      setThinkingRequested: vi.fn(),
      getLastAssistantContent: vi.fn(() => assistantContent),
      replaceLastAssistantMessage: vi.fn(),
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
      onAbortRequest: vi.fn((handler: () => void) => { abortHandler = handler; }),
      hasPendingMessages: vi.fn(() => false),
      flushPendingMessages: vi.fn(),
    };
    const session = {
      getTotalCost: () => 0,
      getChatMessages: () => [{ role: "user", content: "make raw-local-test.html" }],
      addMessage: vi.fn(),
      addUsage: vi.fn(),
      recordTurn: vi.fn(),
      recordToolResult: vi.fn(),
      recordRepoRead: vi.fn(),
      recordRepoEdit: vi.fn(),
      recordIdleCacheCliff: vi.fn(),
      replaceConversation: vi.fn(),
      recordCompaction: vi.fn(),
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages, nextTurn: vi.fn(), trackFileRead: vi.fn() }),
      getCwd: () => process.cwd(),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
    } as any;

    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "writeFile{content:\"<!DOCTYPE html>\"}" };
      })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    await runModelTurn({
      app: app as any,
      session,
      text: "make raw-local-test.html",
      activeModel: { provider: { id: "llamacpp", name: "llama.cpp", defaultModel: "default", models: ["default"] }, runtime: "sdk", model: {} as any, modelId: "default" },
      currentModelId: "default",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      systemPrompt: "system",
      buildTools: () => ({
        writeFile: {
          execute: vi.fn(async (_args: Record<string, unknown>, options?: { abortSignal?: AbortSignal }) => {
            expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
            abortHandler?.();
            return { success: true };
          }),
        },
      }),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      lastActivityTime: Date.now(),
    });

    expect(app.addToolResult).toHaveBeenCalledWith("writeFile", "cancelled", true);
    expect(app.addMessage).toHaveBeenCalledWith("system", "Cancelled.");
    expect(session.addMessage).not.toHaveBeenCalledWith("assistant", "raw-local-test.html created.");
  });
});
