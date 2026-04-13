import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import { createHash } from "crypto";
import { calculateCost, type TokenUsage } from "./cost.js";
import { estimateConversationTokens, estimateTextTokens } from "./tokens.js";
import { resolveThinkingConfig } from "./thinking.js";
import { getModelCapabilities } from "./provider-capabilities.js";
import { getSettings } from "../core/config.js";
import { buildPromptCacheKey } from "../core/context.js";
import { startLocalOpenAIStream } from "./local-openai-stream.js";
import { parsePossiblyPartialJson } from "./native-tool-events.js";
import { getConfiguredProviderBaseUrl } from "../core/models-config.js";
import { getProviderCompat } from "./provider-compat.js";
import { getConfiguredProviderHeaders } from "../core/models-config.js";

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onReasoning: (delta: string) => void;
  onFinish: (usage: TokenUsage) => void;
  onError: (error: Error) => void;
  onToolCallStart?: (toolName: string, callId?: string) => void;
  onToolCall?: (toolName: string, args: unknown, callId?: string) => void;
  onToolResult?: (toolName: string, result: unknown, callId?: string) => void;
  onAfterToolCall?: () => void;
  onAfterResponse?: () => void;
}

export interface StreamOptions {
  model: LanguageModel;
  modelId: string;
  providerId?: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
  tools?: ToolSet;
  abortSignal?: AbortSignal;
  enableThinking?: boolean;
  thinkingLevel?: string;
  maxToolSteps?: number;
  maxOutputTokens?: number;
  toolChoice?: "auto" | "none" | "required" | { type: "tool"; toolName: string };
}

export async function startStream(
  opts: StreamOptions,
  callbacks: StreamCallbacks,
): Promise<void> {
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;

  try {
    const compat = getProviderCompat(opts.providerId, opts.modelId);
    if (shouldUseDirectLocalOpenAIStream(opts)) {
      await startLocalOpenAIStream({
        baseURL: getConfiguredProviderBaseUrl(opts.providerId!) ?? defaultLocalBaseURL(opts.providerId!),
        apiKey: "",
        headers: getConfiguredProviderHeaders(opts.providerId!),
        compat,
        modelId: opts.modelId,
        system: opts.system,
        messages: opts.messages,
        maxOutputTokens: Math.max(256, opts.maxOutputTokens ?? 0),
        abortSignal: opts.abortSignal,
        providerId: opts.providerId,
      }, callbacks);
      return;
    }

    const capabilities = getModelCapabilities({
      providerId: opts.providerId,
      modelId: opts.modelId,
    });
    // Convert messages to AI SDK format with images
    const messages = opts.messages.map((m, index) => {
      const messageCacheable = capabilities.caching.messageEphemeral
        && index < Math.min(2, Math.max(0, opts.messages.length - 1));
      const messageProviderOptions = messageCacheable
        ? { anthropic: { cacheControl: { type: "ephemeral" } } }
        : undefined;
      if (m.images && m.images.length > 0 && m.role === "user") {
        // Create content array with text and images
        const content: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
          { type: "text", text: m.content },
        ];
        for (const img of m.images) {
          content.push({ type: "image", image: `data:${img.mimeType};base64,${img.data}` });
        }
        return { role: m.role as "user", content, ...(messageProviderOptions ? { providerOptions: messageProviderOptions } : {}) };
      }
      return { role: m.role, content: m.content, ...(messageProviderOptions ? { providerOptions: messageProviderOptions } : {}) };
    });

    // Build provider options (thinking/reasoning for supported providers)
    const providerOptions: Record<string, Record<string, any>> = {};
    const estimatedInputTokens = estimateConversationTokens(opts.system, messages as Array<{ role: "user" | "assistant"; content: string | Array<{ type: "text"; text: string } | { type: "image"; image: string }> }>, opts.modelId);
    const thinking = resolveThinkingConfig({
      providerId: opts.providerId,
      modelId: opts.modelId,
      enabled: opts.enableThinking,
      level: opts.thinkingLevel,
    });
      if (thinking.enabled) {
      if (capabilities.reasoning.provider === "anthropic") {
        providerOptions.anthropic = { thinking: { type: "enabled", budgetTokens: thinking.budgetTokens ?? 4096 } };
      } else if (capabilities.reasoning.provider === "openai" && compat.supportsReasoningEffort !== false) {
        providerOptions.openai = { reasoningEffort: { value: thinking.effort ?? "low" } };
      } else if (capabilities.reasoning.provider === "google") {
        providerOptions.google = { thinkingConfig: { thinkingBudget: thinking.budgetTokens ?? 4096 } };
      }
    }
    if (getSettings().enablePromptCaching !== false) {
      if (capabilities.caching.topLevelEphemeral) {
        providerOptions.anthropic = {
          ...(providerOptions.anthropic ?? {}),
          cacheControl: { type: "ephemeral" },
        };
      } else if (capabilities.caching.promptCacheKey) {
        providerOptions.openai = {
          ...(providerOptions.openai ?? {}),
          promptCacheKey: `${buildPromptCacheKey({
            cwd: process.cwd(),
            providerId: opts.providerId,
            modelId: opts.modelId,
          })}:${createHash("sha1").update(opts.system).digest("hex").slice(0, 12)}`,
        };
      }
    }
    if (compat.supportsDeveloperRole === false && capabilities.reasoning.provider === "openai" && capabilities.reasoning.supported) {
      providerOptions.openai = {
        ...(providerOptions.openai ?? {}),
        systemMessageMode: "system",
      };
    }

    const normalizeUsageField = (value: unknown): number =>
      typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

    const emittedToolResultIds = new Set<string>();
    const result = streamText({
      model: opts.model,
      system: opts.system,
      messages,
      tools: opts.tools,
      toolChoice: opts.toolChoice,
      maxOutputTokens: normalizeMaxOutputTokens(opts),
      stopWhen: opts.tools ? stepCountIs(Math.max(2, opts.maxToolSteps ?? 10)) : stepCountIs(1),
      abortSignal: opts.abortSignal,
      providerOptions,
      onError: ({ error }) => {
        if (error instanceof Error) callbacks.onError(error);
      },
      onStepFinish: (event) => {
        if (event.toolResults) {
          for (const tr of event.toolResults) {
            const callId = normalizeToolCallId(tr);
            if (callId && emittedToolResultIds.has(callId)) continue;
            callbacks.onToolResult?.(tr.toolName, tr.output, callId);
            if (callId) emittedToolResultIds.add(callId);
          }
          // Trigger after tool call callback for pending messages
          callbacks.onAfterToolCall?.();
        }
      },
    });

    // Use fullStream for reasoning + text + tool events
    // Tool calls are caught here in real-time (not waiting for onStepFinish)
    // Local models embed thinking in <think>...</think> tags in text stream
    let inThinkTag = false;
    let thinkBuffer = "";
    let streamFailed = false;
    let emittedText = "";
    let emittedReasoning = "";
    const toolInputByCallId = new Map<string, { name: string; input: string }>();
    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          let text: string = (part as any).text ?? (part as any).delta ?? "";

          // Parse <think> tags from local model output
          while (text.length > 0) {
            if (inThinkTag) {
              const closeIdx = text.indexOf("</think>");
              if (closeIdx >= 0) {
                // End of think block
                const reasoningChunk = text.slice(0, closeIdx);
                emittedReasoning += reasoningChunk;
                callbacks.onReasoning(reasoningChunk);
                text = text.slice(closeIdx + 8); // skip "</think>"
                inThinkTag = false;
                thinkBuffer = "";
              } else {
                // Still inside think block
                emittedReasoning += text;
                callbacks.onReasoning(text);
                text = "";
              }
            } else {
              const openIdx = text.indexOf("<think>");
              if (openIdx >= 0) {
                // Start of think block — emit text before it
                if (openIdx > 0) {
                  const textChunk = text.slice(0, openIdx);
                  emittedText += textChunk;
                  callbacks.onText(textChunk);
                }
                text = text.slice(openIdx + 7); // skip "<think>"
                inThinkTag = true;
              } else {
                // Check for partial <think tag at end of chunk
                const partialMatch = text.match(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/);
                if (partialMatch) {
                  const textChunk = text.slice(0, partialMatch.index);
                  emittedText += textChunk;
                  callbacks.onText(textChunk);
                  thinkBuffer = partialMatch[0];
                  text = "";
                } else {
                  // Flush any buffered partial tag that turned out to not be <think>
                  if (thinkBuffer) {
                    emittedText += thinkBuffer;
                    callbacks.onText(thinkBuffer);
                    thinkBuffer = "";
                  }
                  emittedText += text;
                  callbacks.onText(text);
                  text = "";
                }
              }
            }
          }
        } else if (part.type === "reasoning-delta") {
          const reasoningChunk = (part as any).delta ?? (part as any).text ?? "";
          emittedReasoning += reasoningChunk;
          callbacks.onReasoning(reasoningChunk);
        } else if ((part as any).type === "tool-input-start") {
          // Show tool call immediately when model starts generating it
          const tc = part as any;
          const callId = normalizeToolCallId(tc);
          callbacks.onToolCallStart?.(tc.toolName, callId);
          if (callId) toolInputByCallId.set(callId, { name: tc.toolName, input: "" });
        } else if ((part as any).type === "tool-input-delta") {
          const tc = part as any;
          const callId = normalizeToolCallId(tc);
          const toolName = tc.toolName ?? (callId ? toolInputByCallId.get(callId)?.name : undefined) ?? "tool";
          if (callId && !toolInputByCallId.has(callId)) callbacks.onToolCallStart?.(toolName, callId);
          const previous = callId ? toolInputByCallId.get(callId)?.input ?? "" : "";
          const next = `${previous}${typeof tc.delta === "string" ? tc.delta : ""}`;
          if (callId) toolInputByCallId.set(callId, { name: toolName, input: next });
          callbacks.onToolCall?.(toolName, parsePossiblyPartialJson(next), callId);
        } else if (part.type === "tool-call") {
          // Tool call fully formed — pass complete args
          const tc = part as any;
          callbacks.onToolCall?.(tc.toolName, tc.input, normalizeToolCallId(tc));
        } else if ((part as any).type === "tool-result") {
          const tr = part as any;
          const callId = normalizeToolCallId(tr);
          if (callId) emittedToolResultIds.add(callId);
          callbacks.onToolResult?.(tr.toolName, tr.output ?? tr.result, callId);
          callbacks.onAfterToolCall?.();
        }
      }
    } catch (streamErr: unknown) {
      if (streamErr instanceof Error && streamErr.name === "AbortError") return;
      streamFailed = true;
      callbacks.onError(streamErr instanceof Error ? streamErr : new Error(String(streamErr)));
    }

    // If stream failed, still try to get usage but don't block on it
    try {
      const usage = await result.usage;
      const estimatedOutputTokens = estimateTextTokens(emittedText + emittedReasoning, opts.modelId);
      const cacheReadTokens = normalizeUsageField((usage as any).cachedInputTokens ?? (usage as any).cacheReadInputTokens ?? (usage as any).cache_read_input_tokens);
      const cacheWriteTokens = normalizeUsageField((usage as any).cacheCreationInputTokens ?? (usage as any).cacheWriteInputTokens ?? (usage as any).cache_creation_input_tokens);
      const tokenUsage = calculateCost(
        opts.modelId,
        usage.inputTokens && usage.inputTokens > 0 ? usage.inputTokens : estimatedInputTokens,
        usage.outputTokens && usage.outputTokens > 0 ? usage.outputTokens : estimatedOutputTokens,
        opts.providerId,
        { cacheReadTokens, cacheWriteTokens },
      );
      callbacks.onAfterResponse?.();
      callbacks.onFinish(tokenUsage);
    } catch {
      // Usage unavailable after stream error — finish with zeros
      if (!streamFailed) {
        callbacks.onError(new Error("Stream ended unexpectedly"));
      }
      callbacks.onAfterResponse?.();
      callbacks.onFinish(calculateCost(
        opts.modelId,
        estimatedInputTokens,
        estimateTextTokens(emittedText + emittedReasoning, opts.modelId),
        opts.providerId,
      ));
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") return;
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    process.stderr.write = origStderrWrite;
  }
}

function normalizeToolCallId(part: unknown): string | undefined {
  const record = typeof part === "object" && part !== null ? part as Record<string, unknown> : {};
  for (const candidate of [record.toolCallId, record.toolCallID, record.callId, record.call_id, record.id]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function shouldUseDirectLocalOpenAIStream(opts: StreamOptions): boolean {
  return (opts.providerId === "llamacpp" || opts.providerId === "lmstudio" || opts.providerId === "jan" || opts.providerId === "vllm")
    && !opts.tools;
}

function defaultLocalBaseURL(providerId: string): string {
  switch (providerId) {
    case "lmstudio": return "http://127.0.0.1:1234/v1";
    case "jan": return "http://127.0.0.1:1337/v1";
    case "vllm": return "http://127.0.0.1:8000/v1";
    case "llamacpp":
    default: return "http://127.0.0.1:8080/v1";
  }
}

function normalizeMaxOutputTokens(opts: StreamOptions): number | undefined {
  if (!opts.maxOutputTokens) return undefined;
  if (opts.providerId === "llamacpp" || opts.providerId === "lmstudio" || opts.providerId === "jan" || opts.providerId === "vllm") {
    return Math.max(opts.tools ? 1024 : 256, opts.maxOutputTokens);
  }
  return opts.maxOutputTokens;
}
