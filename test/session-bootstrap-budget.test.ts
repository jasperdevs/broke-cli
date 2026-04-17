import { describe, expect, it } from "vitest";
import { bootstrapSession } from "../src/cli/session-bootstrap.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import { Session } from "../src/core/session.js";

describe("session bootstrap budget mode", () => {
  it("prefers the cheapest supported detected provider/model pair for broke mode", async () => {
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

    const result = await bootstrapSession({
      opts: { broke: true },
      app,
      session: new Session(`bootstrap-budget-${Date.now()}`),
      providerRegistry,
      currentMode: "build",
      refreshProviderState: async () => [
        { id: "anthropic", name: "Anthropic", available: true, reason: "configured auth" },
        { id: "openai", name: "OpenAI", available: true, reason: "configured auth" },
        { id: "ollama", name: "Ollama", available: true, reason: "running" },
      ],
    });

    expect(result.activeModel?.provider.id).toBe("openai");
    expect(result.currentModelId).toBe("gpt-5.4-mini");
  }, 15_000);

  it("ignores the synthetic Auto marker when restoring the startup model", async () => {
    const previousAutoRoute = getSettings().autoRoute;
    const previousLastModel = getSettings().lastModel;
    const selected: Array<{ provider: string; model: string }> = [];
    const app = {
      addMessage() {},
      setModel(provider: string, model: string) { selected.push({ provider, model }); },
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

    try {
      updateSetting("autoRoute", true);
      updateSetting("lastModel", "__auto__/__auto__");
      const result = await bootstrapSession({
        opts: {},
        app,
        session: new Session(`bootstrap-auto-${Date.now()}`),
        providerRegistry,
        currentMode: "build",
        refreshProviderState: async () => [
          { id: "openai", name: "OpenAI", available: true, reason: "configured auth" },
        ],
      });

      expect(result.activeModel?.provider.id).toBe("openai");
      expect(result.currentModelId).not.toBe("__auto__");
      expect(selected[0]?.provider).toBe("openai");
      expect(selected[0]?.model).not.toBe("__auto__");
    } finally {
      updateSetting("autoRoute", previousAutoRoute);
      updateSetting("lastModel", previousLastModel);
    }
  });
});
