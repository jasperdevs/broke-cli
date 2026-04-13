import { calculateCost, type TokenUsage } from "./cost.js";
import { estimateConversationTokens, estimateTextTokens } from "./tokens.js";
import type { ProviderCompatSettings } from "./provider-compat.js";

export interface LocalOpenAIStreamOptions {
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  compat?: ProviderCompatSettings;
  modelId: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  providerId?: string;
}

export interface LocalOpenAIStreamCallbacks {
  onText: (delta: string) => void;
  onReasoning: (delta: string) => void;
  onFinish: (usage: TokenUsage) => void;
  onError: (error: Error) => void;
}

function toLocalMessages(opts: LocalOpenAIStreamOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const systemRole = opts.compat?.supportsDeveloperRole === false ? "system" : "system";
  return [
    { role: systemRole, content: opts.system },
    ...opts.messages.map((message) => ({ role: message.role, content: message.content })),
  ];
}

function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, "");
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function extractUsage(raw: unknown, estimatedInput: number, estimatedOutput: number): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  const usage = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const promptDetails = typeof usage.prompt_tokens_details === "object" && usage.prompt_tokens_details !== null
    ? usage.prompt_tokens_details as Record<string, unknown>
    : {};
  const completionDetails = typeof usage.completion_tokens_details === "object" && usage.completion_tokens_details !== null
    ? usage.completion_tokens_details as Record<string, unknown>
    : {};
  return {
    input: toNumber(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens) || estimatedInput,
    output: toNumber(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens)
      + toNumber(completionDetails.reasoning_tokens),
    cacheRead: toNumber(promptDetails.cached_tokens),
    cacheWrite: toNumber(promptDetails.cache_write_tokens),
  };
}

function textFromChoiceDelta(delta: Record<string, unknown>): string {
  return typeof delta.content === "string" ? delta.content : "";
}

function reasoningFromChoiceDelta(delta: Record<string, unknown>): string {
  for (const field of ["reasoning_content", "reasoning", "reasoning_text"]) {
    const value = delta[field];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function parseSseEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let start = 0;
  while (true) {
    const index = buffer.indexOf("\n\n", start);
    if (index < 0) break;
    events.push(buffer.slice(start, index));
    start = index + 2;
  }
  return { events, rest: buffer.slice(start) };
}

function eventData(rawEvent: string): string {
  return rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

export async function startLocalOpenAIStream(
  opts: LocalOpenAIStreamOptions,
  callbacks: LocalOpenAIStreamCallbacks,
): Promise<void> {
  const estimatedInput = estimateConversationTokens(opts.system, opts.messages, opts.modelId);
  let emittedText = "";
  let emittedReasoning = "";
  let finalUsage: unknown;

  try {
    const response = await fetch(`${normalizeBaseURL(opts.baseURL)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.headers ?? {}),
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      signal: opts.abortSignal,
      body: JSON.stringify({
        model: opts.modelId,
        messages: toLocalMessages(opts),
        stream: true,
        ...(opts.compat?.supportsUsageInStreaming === false ? {} : { stream_options: { include_usage: true } }),
        ...(opts.maxOutputTokens
          ? { [(opts.compat?.maxTokensField ?? "max_tokens")]: opts.maxOutputTokens }
          : {}),
        ...(opts.compat?.thinkingFormat === "qwen" ? { enable_thinking: true } : {}),
      }),
    });
    if (!response.ok || !response.body) {
      callbacks.onError(new Error(`local OpenAI-compatible stream failed: HTTP ${response.status}`));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const parsed = parseSseEvents(buffer);
      buffer = parsed.rest;
      for (const rawEvent of parsed.events) {
        const data = eventData(rawEvent).trim();
        if (!data || data === "[DONE]") continue;
        const chunk = JSON.parse(data) as Record<string, unknown>;
        if (chunk.usage) finalUsage = chunk.usage;
        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        const choice = choices[0] as Record<string, unknown> | undefined;
        const delta = typeof choice?.delta === "object" && choice.delta !== null ? choice.delta as Record<string, unknown> : {};
        const reasoning = reasoningFromChoiceDelta(delta);
        if (reasoning) {
          emittedReasoning += reasoning;
          callbacks.onReasoning(reasoning);
        }
        const text = textFromChoiceDelta(delta);
        if (text) {
          emittedText += text;
          callbacks.onText(text);
        }
      }
    }

    const estimatedOutput = estimateTextTokens(emittedText + emittedReasoning, opts.modelId);
    const parsedUsage = extractUsage(finalUsage, estimatedInput, estimatedOutput);
    callbacks.onFinish(calculateCost(
      opts.modelId,
      parsedUsage.input,
      parsedUsage.output || estimatedOutput,
      opts.providerId,
      { cacheReadTokens: parsedUsage.cacheRead, cacheWriteTokens: parsedUsage.cacheWrite },
    ));
  } catch (error) {
    if (opts.abortSignal?.aborted) return;
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}
