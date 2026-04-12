import { describe, expect, it } from "vitest";
import { bootstrapSession } from "../src/cli/session-bootstrap.js";
import { Session } from "../src/core/session.js";

describe("session bootstrap budget mode", () => {
  it("prefers the cheapest detected provider/model pair for broke mode", async () => {
    const app = {
      addMessage() {},
      setModel() {},
      setMode() {},
      clearStatus() {},
    };
    const providerRegistry = {
      createModel: (providerId: string, modelId?: string) => ({
        provider: { id: providerId, name: providerId, defaultModel: modelId ?? "default", models: [modelId ?? "default"] },
        modelId: modelId ?? "default",
        runtime: "sdk",
        model: {} as any,
      }),
      hasVisibleModel: () => true,
    } as any;
    const session = new Session(`bootstrap-budget-${Date.now()}`);

    const result = await bootstrapSession({
      opts: { broke: true },
      app,
      session,
      providerRegistry,
      currentMode: "build",
      refreshProviderState: async () => [
        { id: "anthropic", name: "Anthropic", available: true, reason: "API key" },
        { id: "openai", name: "OpenAI", available: true, reason: "API key" },
        { id: "ollama", name: "Ollama", available: true, reason: "running" },
      ],
    });

    expect(result.activeModel?.provider.id).toBe("ollama");
    expect(result.currentModelId).toBe("qwen2.5-coder:7b");
  });
});
