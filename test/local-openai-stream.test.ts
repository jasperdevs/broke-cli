import { describe, expect, it, vi } from "vitest";
import { startLocalOpenAIStream } from "../src/ai/local-openai-stream.js";

function sse(chunks: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

describe("local OpenAI-compatible stream", () => {
  it("surfaces llama.cpp reasoning_content and visible content as separate deltas", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: sse([
        { choices: [{ delta: { reasoning_content: "think " } }] },
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: "!" } }], usage: { prompt_tokens: 7, completion_tokens: 3 } },
      ]),
    } as Response);
    const text: string[] = [];
    const reasoning: string[] = [];

    await startLocalOpenAIStream({
      baseURL: "http://127.0.0.1:8080/v1",
      apiKey: "llamacpp",
      modelId: "local/model",
      system: "system",
      messages: [{ role: "user", content: "hey" }],
      providerId: "llamacpp",
      maxOutputTokens: 256,
    }, {
      onText: (delta) => text.push(delta),
      onReasoning: (delta) => reasoning.push(delta),
      onFinish: vi.fn(),
      onError: (error) => { throw error; },
    });

    expect(reasoning.join("")).toBe("think ");
    expect(text.join("")).toBe("Hello!");
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe("local/model");
    expect(body.max_tokens).toBe(256);
    fetchMock.mockRestore();
  });
});
