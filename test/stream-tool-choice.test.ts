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
  getSettings: () => ({
    enablePromptCaching: false,
    thinkingBudgets: {},
  }),
}));

vi.mock("../src/core/context.js", () => ({
  buildPromptCacheKey: () => "brokecli:test",
}));

import { startStream } from "../src/ai/stream.js";

describe("stream tool choice", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockClear();
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {})(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });
  });

  it("passes through a forced SDK tool choice when requested", async () => {
    await startStream({
      model: {} as any,
      modelId: "test",
      system: "sys",
      messages: [{ role: "user", content: "edit README.md" }],
      tools: { editFile: {} } as any,
      toolChoice: { type: "tool", toolName: "editFile" },
    }, {
      onText: () => {},
      onReasoning: () => {},
      onFinish: () => {},
      onError: () => {},
    });

    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      toolChoice: { type: "tool", toolName: "editFile" },
    }));
  });
});
