import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/core/config.js", () => ({
  getSettings: () => ({
    cavemanLevel: "ultra",
    enableThinking: false,
    thinkingLevel: "off",
  }),
}));

vi.mock("../src/ai/stream.js", () => ({
  startStream: vi.fn(),
}));

vi.mock("../src/ai/native-stream.js", () => ({
  startNativeStream: vi.fn(),
}));

import { resolveOneShotModel, runOneShotPrompt } from "../src/cli/oneshot.js";

describe("one-shot repo fast path", () => {
  it("keeps slash-containing local model IDs intact when --provider is explicit", async () => {
    const created: Array<{ providerId: string; modelId?: string }> = [];
    const result = await resolveOneShotModel({
      opts: {
        provider: "llamacpp",
        model: "ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M",
      },
      providers: [{ id: "llamacpp", name: "llama.cpp", available: true, reason: "running" }],
      providerRegistry: {
        createModel: (providerId: string, modelId?: string) => {
          created.push({ providerId, modelId });
          return {
            provider: { id: providerId, name: "llama.cpp", defaultModel: "default", models: [] },
            modelId: modelId ?? "default",
            runtime: "sdk",
            model: {} as any,
          };
        },
      } as any,
    });

    expect(created).toEqual([{ providerId: "llamacpp", modelId: "ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M" }]);
    expect(result.providerId).toBe("llamacpp");
    expect(result.modelId).toBe("ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M");
  });

  it("preserves resolved provider/model metadata when a repo fast path handles the prompt", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "brokecli-oneshot-fastpath-"));
    const previousCwd = process.cwd();
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "src/math.js"), "export function sumNumbers(a, b) { return a + b; }\n", "utf8");

    try {
      process.chdir(workspace);
      const result = await runOneShotPrompt({
        prompt: "Rename sumNumbers to addNumbers across this repo and keep behavior unchanged.",
        mode: "build",
        providers: [{ id: "openai", name: "OpenAI", available: true, reason: "API key" }],
        providerRegistry: {
          createModel: () => ({
            provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: ["gpt-5.4-mini"] },
            modelId: "gpt-5.4-mini",
            runtime: "sdk",
            model: {} as any,
          }),
        } as any,
        opts: { provider: "openai", model: "gpt-5.4-mini" },
      });

      expect(result.providerId).toBe("deterministic");
      expect(result.modelId).toBe("fastpath");
      expect(result.session.getProvider()).toBe("deterministic");
      expect(result.session.getModel()).toBe("fastpath");
      expect(result.session.getBudgetMetrics().totalTurns).toBe(1);
      expect(result.usage.cost).toBe(0);
    } finally {
      process.chdir(previousCwd);
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
