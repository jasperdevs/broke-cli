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
}));

vi.mock("../src/ai/tokens.js", () => ({
  estimateConversationTokens: () => 1,
  estimateTextTokens: () => 1,
}));

vi.mock("../src/core/config.js", () => ({
  getBaseUrl: () => undefined,
  getSettings: () => ({
    enablePromptCaching: false,
    thinkingBudgets: {},
  }),
}));

vi.mock("../src/core/context.js", () => ({
  buildPromptCacheKey: () => "brokecli:test",
}));

import { startStream } from "../src/ai/stream.js";

describe("SDK live tool events", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockClear();
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

  it("passes a hard max output budget when requested", async () => {
    await startStream({
      model: {} as any,
      modelId: "test",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 64,
    }, {
      onText: () => {},
      onReasoning: () => {},
      onFinish: () => {},
      onError: () => {},
    });

    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      maxOutputTokens: 64,
    }));
  });

  it("keeps starts, argument deltas, calls, and results tied to the provider call id", async () => {
    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "tool-input-start", toolName: "readFile", toolCallId: "sdk_1" };
        yield { type: "tool-input-delta", toolCallId: "sdk_1", delta: "{\"path\":\"README.md\"" };
        yield { type: "tool-call", toolName: "readFile", toolCallId: "sdk_1", input: { path: "README.md", mode: "minimal" } };
        yield { type: "tool-result", toolName: "readFile", toolCallId: "sdk_1", output: { success: true, content: "hello" } };
      })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    const events: string[] = [];
    await startStream({
      model: {} as any,
      modelId: "test",
      system: "sys",
      messages: [{ role: "user", content: "read" }],
      tools: { readFile: {} } as any,
    }, {
      onText: () => {},
      onReasoning: () => {},
      onFinish: () => events.push("finish"),
      onError: (error) => { throw error; },
      onToolCallStart: (name, id) => events.push(`start:${name}:${id}`),
      onToolCall: (name, args, id) => events.push(`call:${name}:${id}:${JSON.stringify(args)}`),
      onToolResult: (name, result, id) => events.push(`result:${name}:${id}:${JSON.stringify(result)}`),
      onAfterToolCall: () => events.push("after-tool"),
    });

    expect(events).toEqual([
      "start:readFile:sdk_1",
      'call:readFile:sdk_1:{"path":"README.md"}',
      'call:readFile:sdk_1:{"path":"README.md","mode":"minimal"}',
      'result:readFile:sdk_1:{"success":true,"content":"hello"}',
      "after-tool",
      "finish",
    ]);
  });
});
