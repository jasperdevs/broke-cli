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
  getSettings: () => ({ thinkingBudgets: {} }),
}));

import { startStream } from "../src/ai/stream.js";

describe("stream tool steps", () => {
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
});
