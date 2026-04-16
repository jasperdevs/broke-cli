import { afterEach, describe, expect, it, vi } from "vitest";
import { startGoogleCloudCodeStream } from "../src/ai/google-cloud-code-stream.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function sseResponse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("Google Cloud Code Assist OAuth stream", () => {
  it("streams text and usage from the Cloud Code Assist SSE endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse([
      {
        response: {
          candidates: [{ content: { parts: [{ text: "Hello" }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
        },
      },
      { response: { candidates: [{ content: { parts: [{ text: " there" }] } }] } },
    ]));
    let text = "";
    let usage = { inputTokens: 0, outputTokens: 0 };

    await startGoogleCloudCodeStream({
      providerId: "google-gemini-cli",
      modelId: "gemini-2.5-pro",
      credential: JSON.stringify({ token: "access-token", projectId: "project-1" }),
      system: "system",
      messages: [{ role: "user", content: "hi" }],
    }, {
      onText: (delta) => { text += delta; },
      onReasoning: () => {},
      onError: (error) => { throw error; },
      onFinish: (result) => { usage = result; },
    });

    expect(text).toBe("Hello there");
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
  });

  it("tries Antigravity endpoint fallbacks on 403", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(sseResponse([{ response: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } }]));
    let text = "";

    await startGoogleCloudCodeStream({
      providerId: "google-antigravity",
      modelId: "gemini-3.1-pro-high",
      credential: JSON.stringify({ token: "token", projectId: "project-1" }),
      system: "",
      messages: [{ role: "user", content: "hi" }],
    }, {
      onText: (delta) => { text += delta; },
      onReasoning: () => {},
      onError: (error) => { throw error; },
      onFinish: () => {},
    });

    expect(text).toBe("ok");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://autopush-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse",
      expect.any(Object),
    );
  });
});
