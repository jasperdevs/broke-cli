import { beforeEach, describe, expect, it, vi } from "vitest";

const streamMocks = vi.hoisted(() => ({
  startStream: vi.fn(),
  startNativeStream: vi.fn(),
}));

vi.mock("../src/ai/stream.js", () => ({
  startStream: streamMocks.startStream,
}));

vi.mock("../src/ai/native-stream.js", () => ({
  startNativeStream: streamMocks.startNativeStream,
}));

vi.mock("../src/ai/model-catalog.js", () => ({
  getPrettyModelName: (modelId: string) => modelId,
}));

vi.mock("../src/core/config.js", () => ({
  getSettings: () => ({
    enableThinking: true,
    thinkingLevel: "low",
  }),
}));

import { Session } from "../src/core/session.js";
import { buildBtwMessages, buildBtwPrompt, runBtwQuestion } from "../src/cli/btw-runtime.js";

describe("/btw runtime", () => {
  beforeEach(() => {
    streamMocks.startStream.mockReset();
    streamMocks.startNativeStream.mockReset();
    streamMocks.startStream.mockResolvedValue(undefined);
    streamMocks.startNativeStream.mockResolvedValue(undefined);
  });

  it("wraps the side question in the Claude-style reminder block", () => {
    const prompt = buildBtwPrompt("does this touch tests?");
    expect(prompt).toContain("<system-reminder>");
    expect(prompt).toContain("You have NO tools available");
    expect(prompt).toContain("does this touch tests?");
  });

  it("uses saved chat messages plus the wrapped question", () => {
    const session = new Session(`btw-msgs-${Date.now()}`);
    session.addMessage("user", "hello");
    session.addMessage("assistant", "working on it");

    const messages = buildBtwMessages(session, "status?");

    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]?.content).toContain("<system-reminder>");
    expect(messages[2]?.content).toContain("status?");
  });

  it("runs sdk btw questions without exposing tools", async () => {
    const session = new Session(`btw-sdk-${Date.now()}`);
    session.addMessage("user", "hello");
    const app = {
      openBtwBubble: vi.fn(),
      appendBtwBubble: vi.fn(),
      finishBtwBubble: vi.fn(),
    };
    const model = { provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: [] }, runtime: "sdk", model: {} } as any;

    await runBtwQuestion({
      session,
      question: "status?",
      activeModel: model,
      currentModelId: "gpt-5.4-mini",
      model,
      modelId: "gpt-5.4-mini",
      systemPrompt: "system",
      buildRuntimeSystemPrompt: () => "system",
      onUsage: vi.fn(),
      app,
    });

    expect(streamMocks.startStream).toHaveBeenCalledTimes(1);
    const [opts] = streamMocks.startStream.mock.calls[0];
    expect(opts.tools).toBeUndefined();
    expect(opts.messages.at(-1)?.content).toContain("<system-reminder>");
  });

  it("runs native btw questions in plan mode with tool denial enabled", async () => {
    const session = new Session(`btw-native-${Date.now()}`);
    session.addMessage("user", "hello");
    const app = {
      openBtwBubble: vi.fn(),
      appendBtwBubble: vi.fn(),
      finishBtwBubble: vi.fn(),
    };
    const model = { provider: { id: "anthropic", name: "Claude Code", defaultModel: "claude-sonnet-4-6", models: [] }, runtime: "native-cli" } as any;

    await runBtwQuestion({
      session,
      question: "status?",
      activeModel: model,
      currentModelId: "claude-sonnet-4-6",
      model,
      modelId: "claude-sonnet-4-6",
      systemPrompt: "system",
      buildRuntimeSystemPrompt: () => "system",
      onUsage: vi.fn(),
      app,
    });

    expect(streamMocks.startNativeStream).toHaveBeenCalledTimes(1);
    const [opts] = streamMocks.startNativeStream.mock.calls[0];
    expect(opts.permissionMode).toBe("plan");
    expect(opts.denyToolUse).toBe(true);
  });
});
