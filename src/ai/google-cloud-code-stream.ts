import { calculateCost } from "./cost.js";
import { estimateConversationTokens, estimateTextTokens } from "./tokens.js";
import type { StreamCallbacks } from "./stream.js";

export interface GoogleCloudCodeStreamOptions {
  providerId: "google-gemini-cli" | "google-antigravity";
  modelId: string;
  credential: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
  abortSignal?: AbortSignal;
  enableThinking?: boolean;
  maxOutputTokens?: number;
}

interface GoogleCloudCredential {
  token: string;
  projectId: string;
}

const CLOUD_CODE_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const ANTIGRAVITY_ENDPOINTS = [
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://autopush-cloudcode-pa.sandbox.googleapis.com",
  CLOUD_CODE_ENDPOINT,
] as const;

const GEMINI_HEADERS = {
  "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": JSON.stringify({
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  }),
};

const ANTIGRAVITY_HEADERS = {
  "User-Agent": "antigravity/1.18.4 darwin/arm64",
};

function parseCredential(raw: string): GoogleCloudCredential {
  try {
    const parsed = JSON.parse(raw) as { token?: string; access?: string; projectId?: string };
    const token = parsed.token ?? parsed.access;
    if (!token || !parsed.projectId) throw new Error("missing token or projectId");
    return { token, projectId: parsed.projectId };
  } catch {
    throw new Error("Invalid Google OAuth credentials. Run /login google-gemini-cli or /login google-antigravity again.");
  }
}

function toGoogleRole(role: "user" | "assistant"): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function convertMessages(messages: GoogleCloudCodeStreamOptions["messages"]) {
  return messages.map((message) => ({
    role: toGoogleRole(message.role),
    parts: [
      ...(message.content ? [{ text: message.content }] : []),
      ...(message.images ?? []).map((image) => ({
        inlineData: {
          mimeType: image.mimeType,
          data: image.data,
        },
      })),
    ],
  }));
}

function buildRequestBody(
  opts: GoogleCloudCodeStreamOptions,
  projectId: string,
): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {};
  if (opts.maxOutputTokens) generationConfig.maxOutputTokens = opts.maxOutputTokens;
  if (opts.enableThinking === false && /gemini-2\./i.test(opts.modelId)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  return {
    project: projectId,
    model: opts.modelId,
    request: {
      contents: convertMessages(opts.messages),
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    },
    ...(opts.providerId === "google-antigravity" ? { requestType: "agent" } : {}),
    userAgent: opts.providerId === "google-antigravity" ? "antigravity" : "brokecli",
    requestId: `${opts.providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

function streamEndpoints(providerId: GoogleCloudCodeStreamOptions["providerId"]): readonly string[] {
  return providerId === "google-antigravity" ? ANTIGRAVITY_ENDPOINTS : [CLOUD_CODE_ENDPOINT];
}

function streamHeaders(providerId: GoogleCloudCodeStreamOptions["providerId"], token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(providerId === "google-antigravity" ? ANTIGRAVITY_HEADERS : GEMINI_HEADERS),
  };
}

async function fetchStreamResponse(
  opts: GoogleCloudCodeStreamOptions,
  token: string,
  body: string,
): Promise<Response> {
  const headers = streamHeaders(opts.providerId, token);
  let lastError: Error | null = null;
  for (const endpoint of streamEndpoints(opts.providerId)) {
    const response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers,
      body,
      signal: opts.abortSignal,
    });
    if (response.ok) return response;
    const text = await response.text();
    lastError = new Error(`Cloud Code Assist API error (${response.status}): ${text}`);
    if (response.status !== 403 && response.status !== 404) break;
  }
  throw lastError ?? new Error("Cloud Code Assist API request failed.");
}

async function* readSse(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) throw new Error("Cloud Code Assist API returned no response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const json = line.slice(5).trim();
        if (!json || json === "[DONE]") continue;
        try {
          yield JSON.parse(json) as Record<string, unknown>;
        } catch {
          // Ignore malformed keepalive chunks.
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }
}

function extractUsage(chunk: Record<string, unknown>): {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
} | null {
  const response = typeof chunk.response === "object" && chunk.response ? chunk.response as Record<string, unknown> : null;
  const usage = typeof response?.usageMetadata === "object" && response.usageMetadata
    ? response.usageMetadata as Record<string, unknown>
    : null;
  if (!usage) return null;
  const prompt = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : undefined;
  const cached = typeof usage.cachedContentTokenCount === "number" ? usage.cachedContentTokenCount : 0;
  const candidates = typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0;
  const thoughts = typeof usage.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : 0;
  return {
    inputTokens: prompt === undefined ? undefined : Math.max(0, prompt - cached),
    outputTokens: candidates + thoughts,
    cacheReadTokens: cached,
  };
}

function extractParts(chunk: Record<string, unknown>): Array<{ text?: string; thought?: boolean }> {
  const response = typeof chunk.response === "object" && chunk.response ? chunk.response as Record<string, unknown> : null;
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const first = typeof candidates[0] === "object" && candidates[0] ? candidates[0] as Record<string, unknown> : null;
  const content = typeof first?.content === "object" && first.content ? first.content as Record<string, unknown> : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts.filter((part): part is { text?: string; thought?: boolean } => typeof part === "object" && part !== null);
}

export async function startGoogleCloudCodeStream(
  opts: GoogleCloudCodeStreamOptions,
  callbacks: StreamCallbacks,
): Promise<void> {
  const { token, projectId } = parseCredential(opts.credential);
  const body = JSON.stringify(buildRequestBody(opts, projectId));
  const estimatedInputTokens = estimateConversationTokens(opts.system, opts.messages, opts.modelId);
  let emittedText = "";
  let emittedReasoning = "";
  let usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } | null = null;

  try {
    const response = await fetchStreamResponse(opts, token, body);
    for await (const chunk of readSse(response)) {
      if (opts.abortSignal?.aborted) throw new Error("Request was aborted");
      usage = extractUsage(chunk) ?? usage;
      for (const part of extractParts(chunk)) {
        if (!part.text) continue;
        if (part.thought) {
          emittedReasoning += part.text;
          callbacks.onReasoning(part.text);
        } else {
          emittedText += part.text;
          callbacks.onText(part.text);
        }
      }
    }
    const estimatedOutputTokens = estimateTextTokens(emittedText + emittedReasoning, opts.modelId);
    callbacks.onAfterResponse?.();
    callbacks.onFinish(calculateCost(
      opts.modelId,
      usage?.inputTokens ?? estimatedInputTokens,
      usage?.outputTokens ?? estimatedOutputTokens,
      opts.providerId,
      { cacheReadTokens: usage?.cacheReadTokens ?? 0 },
    ));
  } catch (error) {
    if (opts.abortSignal?.aborted) return;
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}
