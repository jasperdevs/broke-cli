import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import { calculateCost, type TokenUsage } from "./cost.js";

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onReasoning: (delta: string) => void;
  onFinish: (usage: TokenUsage) => void;
  onError: (error: Error) => void;
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
}

export async function startStream(
  opts: StreamOptions,
  callbacks: StreamCallbacks,
): Promise<void> {
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;

  try {
    // Convert messages to AI SDK format with images
    const messages = opts.messages.map((m) => {
      if (m.images && m.images.length > 0 && m.role === "user") {
        // Create content array with text and images
        const content: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
          { type: "text", text: m.content },
        ];
        for (const img of m.images) {
          content.push({ type: "image", image: `data:${img.mimeType};base64,${img.data}` });
        }
        return { role: m.role as "user", content };
      }
      return { role: m.role, content: m.content };
    });

    // Build provider options (thinking/reasoning for supported providers)
    const providerOptions: Record<string, Record<string, Record<string, string | number>>> = {};
    if (opts.enableThinking) {
      const level = opts.thinkingLevel || "low";
      if (opts.providerId === "anthropic") {
        // Anthropic: budget-based thinking
        const budgets: Record<string, number> = { low: 5000, medium: 12000, high: 25000 };
        providerOptions.anthropic = { thinking: { type: "enabled", budgetTokens: budgets[level] ?? 5000 } };
      } else if (opts.providerId === "openai") {
        // OpenAI: reasoning_effort (low/medium/high map directly)
        providerOptions.openai = { reasoningEffort: { value: level } };
      } else if (opts.providerId === "google") {
        // Google: thinkingBudget
        const budgets: Record<string, number> = { low: 4096, medium: 12000, high: 24000 };
        providerOptions.google = { thinkingConfig: { thinkingBudget: budgets[level] ?? 4096 } };
      }
    }

    const result = streamText({
      model: opts.model,
      system: opts.system,
      messages,
      tools: opts.tools,
      stopWhen: opts.tools ? stepCountIs(10) : stepCountIs(1),
      abortSignal: opts.abortSignal,
      providerOptions,
      onError: ({ error }) => {
        if (error instanceof Error) callbacks.onError(error);
      },
      onStepFinish: (event) => {
        if (event.toolCalls) {
          for (const tc of event.toolCalls) {
            callbacks.onToolCall?.(tc.toolName, tc.input);
          }
        }
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
    let streamFailed = false;
    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          callbacks.onText((part as any).text ?? (part as any).delta ?? "");
        } else if (part.type === "reasoning-delta") {
          callbacks.onReasoning((part as any).delta ?? (part as any).text ?? "");
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
      const tokenUsage = calculateCost(
        opts.modelId,
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
      );
      callbacks.onAfterResponse?.();
      callbacks.onFinish(tokenUsage);
    } catch {
      // Usage unavailable after stream error — finish with zeros
      if (!streamFailed) {
        callbacks.onError(new Error("Stream ended unexpectedly"));
      }
      callbacks.onAfterResponse?.();
      callbacks.onFinish(calculateCost(opts.modelId, 0, 0));
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") return;
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    process.stderr.write = origStderrWrite;
  }
}
