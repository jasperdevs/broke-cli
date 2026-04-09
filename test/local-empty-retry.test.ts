import { describe, expect, it, vi } from "vitest";
import { executeTurnWithRetries } from "../src/cli/turn-runner-flow.js";

describe("local empty response retry", () => {
  it("retries an empty main local-model response with a direct-answer contract", async () => {
    const app = {
      setStreamingActivitySummary: vi.fn(),
      setStreaming: vi.fn(),
      setStatus: vi.fn(),
    };
    const session = {
      getContextOptimizer: () => ({ optimizeMessages: (messages: any[]) => messages }),
    };
    const calls: any[] = [];
    const result = await executeTurnWithRetries({
      app: app as any,
      session: session as any,
      text: "hey",
      activeModel: { provider: { id: "llamacpp", name: "llama.cpp", defaultModel: "gemma", models: [] }, runtime: "sdk", model: {} as any, modelId: "gemma" },
      currentModelId: "gemma",
      smallModel: null,
      smallModelId: "",
      currentMode: "build",
      policy: {
        archetype: "casual",
        allowedTools: [],
        maxToolSteps: 0,
        scaffold: "lane cheap\nanswer brief\nno tools",
        scaffoldSource: "builtin",
        preferSmallExecutor: false,
        promptProfile: "casual",
        historyWindow: 2,
      },
      buildTools: () => ({}),
      hooks: { emit: () => {} },
      lastToolCalls: [],
      prepared: {
        contextLimit: 128000,
        turnSystemPrompt: "system",
        selectedMessages: [],
        contextTokens: 1,
        contextPct: 1,
        spend: {
          systemPromptTokens: 1,
          replayInputTokens: 1,
          stateCarrierTokens: 0,
          transientContextTokens: 0,
        },
      },
      transientUserContext: undefined,
      executeTurnForTests: async (options: any) => {
        calls.push(options);
        return calls.length === 1
          ? {
              nextToolCalls: [],
              lastActivityTime: 1,
              steeringInterrupted: false,
              resolvedRoute: "main",
              completion: "empty",
              toolActivity: false,
              assistantText: "",
            }
          : {
              nextToolCalls: [],
              lastActivityTime: 2,
              steeringInterrupted: false,
              resolvedRoute: "main",
              completion: "success",
              toolActivity: false,
              assistantText: "Hey.",
            };
      },
    } as any);

    expect(calls).toHaveLength(2);
    expect(calls[1].activeSystemPrompt).toContain("Local-model empty-output recovery");
    expect(app.setStatus).not.toHaveBeenCalled();
    expect(result.result.assistantText).toBe("Hey.");
  });
});
