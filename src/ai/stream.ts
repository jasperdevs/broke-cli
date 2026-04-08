import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import { createHash } from "crypto";
import { calculateCost, type TokenUsage } from "./cost.js";
import { estimateConversationTokens, estimateTextTokens } from "./tokens.js";
import { resolveThinkingConfig } from "./thinking.js";
import { getSettings } from "../core/config.js";
import { buildPromptCacheKey } from "../core/context.js";

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onReasoning: (delta: string) => void;
  onFinish: (usage: TokenUsage) => void;
  onError: (error: Error) => void;
  onToolCallStart?: (toolName: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
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
}

export async function startStream(
  opts: StreamOptions,
  callbacks: StreamCallbacks,
): Promise<void> {
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;

  try {
    // Convert messages to AI SDK format with images
    const messages = opts.messages.map((m, index) => {
      const anthropicCacheable = opts.providerId === "anthropic" && index < Math.min(2, Math.max(0, opts.messages.length - 1));
      const messageProviderOptions = anthropicCacheable
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
      if (opts.providerId === "anthropic") {
        providerOptions.anthropic = { thinking: { type: "enabled", budgetTokens: thinking.budgetTokens ?? 4096 } };
      } else if (opts.providerId === "openai") {
        providerOptions.openai = { reasoningEffort: { value: thinking.effort ?? "low" } };
      } else if (opts.providerId === "google") {
        providerOptions.google = { thinkingConfig: { thinkingBudget: thinking.budgetTokens ?? 4096 } };
      }
    }
    if (getSettings().enablePromptCaching !== false) {
      if (opts.providerId === "anthropic") {
        providerOptions.anthropic = {
          ...(providerOptions.anthropic ?? {}),
          cacheControl: { type: "ephemeral" },
        };
      } else if (opts.providerId === "openai" || opts.providerId === "codex") {
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

    const normalizeUsageField = (value: unknown): number =>
      typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

    const result = streamText({
      model: opts.model,
      system: opts.system,
      messages,
      tools: opts.tools,
      stopWhen: opts.tools ? stepCountIs(Math.max(2, opts.maxToolSteps ?? 10)) : stepCountIs(1),
      abortSignal: opts.abortSignal,
      providerOptions,
      onError: ({ error }) => {
        if (error instanceof Error) callbacks.onError(error);
      },
      onStepFinish: (event) => {
        if (event.toolResults) {
          for (const tr of event.toolResults) {
            callbacks.onToolResult?.(tr.toolName, tr.output);
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
          callbacks.onToolCallStart?.(tc.toolName);
        } else if (part.type === "tool-call") {
          // Tool call fully formed — pass complete args
          const tc = part as any;
          callbacks.onToolCall?.(tc.toolName, tc.input);
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
