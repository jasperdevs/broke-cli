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
    enablePromptCaching: true,
  }),
}));

vi.mock("../src/core/context.js", () => ({
  buildPromptCacheKey: () => "brokecli:test",
}));

import { startStream } from "../src/ai/stream.js";

describe("stream provider capabilities", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockClear();
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {})(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });
  });

  it("passes provider-native cache hints only for supported providers", async () => {
    await startStream({
      model: {} as any,
      modelId: "claude-sonnet",
      providerId: "anthropic",
      system: "sys",
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    }, {
      onText: () => {},
      onReasoning: () => {},
      onFinish: () => {},
      onError: () => {},
    });

    const anthropicCall = streamTextMock.mock.calls.at(-1)?.[0];
    expect(anthropicCall.providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" });
    expect(anthropicCall.messages[0].providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" });

    await startStream({
      model: {} as any,
      modelId: "gpt-5.4-mini",
      providerId: "openai",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    }, {
      onText: () => {},
      onReasoning: () => {},
      onFinish: () => {},
      onError: () => {},
    });

    const openaiCall = streamTextMock.mock.calls.at(-1)?.[0];
    expect(openaiCall.providerOptions.openai.promptCacheKey).toContain("brokecli:");

    await startStream({
      model: {} as any,
      modelId: "default",
      providerId: "ollama",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    }, {
      onText: () => {},
      onReasoning: () => {},
      onFinish: () => {},
      onError: () => {},
    });

    const ollamaCall = streamTextMock.mock.calls.at(-1)?.[0];
    expect(ollamaCall.providerOptions.openai).toBeUndefined();
    expect(ollamaCall.messages[0].providerOptions).toBeUndefined();
  });
});
