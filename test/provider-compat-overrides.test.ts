import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getModelCapabilities } from "../src/ai/provider-capabilities.js";
import { filterModelIdsForDisplay } from "../src/ai/provider-visibility.js";
import { setRuntimeModelsConfigPathsForTests } from "../src/core/models-config.js";
import { startLocalOpenAIStream } from "../src/ai/local-openai-stream.js";
import { canUseSdkTools } from "../src/cli/turn-runner-support.js";

function sse(chunks: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

describe.sequential("provider compat overrides", () => {
  let root = "";
  let globalModelsPath = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "brokecli-compat-"));
    globalModelsPath = join(root, "global-models.json");
    setRuntimeModelsConfigPathsForTests({ global: globalModelsPath, project: join(root, "project-models.json") });
  });

  afterEach(() => {
    setRuntimeModelsConfigPathsForTests(null);
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("lets models.json disable reasoning-effort and restore full thinking levels for local openai-compatible models", () => {
    writeFileSync(globalModelsPath, JSON.stringify({
      providers: {
        ollama: {
          compat: {
            supportsReasoningEffort: false,
          },
          models: [
            { id: "gpt-oss:20b", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 16384 },
          ],
        },
      },
    }), "utf-8");

    const caps = getModelCapabilities({
      providerId: "ollama",
      modelId: "gpt-oss:20b",
      runtime: "sdk",
    });

    expect(caps.reasoning.supported).toBe(true);
    expect(caps.reasoning.levels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("lets local stream compat switch to max_completion_tokens and omit usage streaming", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: sse([{ choices: [{ delta: { content: "ok" } }] }]),
    } as Response);

    await startLocalOpenAIStream({
      baseURL: "http://127.0.0.1:8080/v1",
      apiKey: "",
      headers: { "x-test": "1" },
      compat: {
        supportsUsageInStreaming: false,
        maxTokensField: "max_completion_tokens",
      },
      modelId: "local/model",
      system: "system",
      messages: [{ role: "user", content: "hey" }],
      providerId: "llamacpp",
      maxOutputTokens: 256,
    }, {
      onText: () => {},
      onReasoning: () => {},
      onFinish: () => {},
      onError: (error) => { throw error; },
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.stream_options).toBeUndefined();
    expect(body.max_completion_tokens).toBe(256);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-test": "1" });
  });

  it("lets compat disable tool usage and hide unsupported models", () => {
    writeFileSync(globalModelsPath, JSON.stringify({
      providers: {
        openai: {
          models: [
            { id: "gpt-5.4-mini", compat: { supportsTools: false } },
            { id: "gpt-4o", compat: { supportsTools: true } },
          ],
        },
      },
    }), "utf-8");

    expect(filterModelIdsForDisplay("openai", ["gpt-5.4-mini", "gpt-4o"])).toEqual(["gpt-4o"]);
    expect(canUseSdkTools({
      runtime: "sdk",
      model: {} as any,
      modelId: "gpt-5.4-mini",
      provider: { id: "openai" } as any,
    })).toBe(false);
  });
});
