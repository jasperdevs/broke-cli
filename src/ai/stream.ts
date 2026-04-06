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
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
  tools?: ToolSet;
  abortSignal?: AbortSignal;
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

    const result = streamText({
      model: opts.model,
      system: opts.system,
      messages,
      tools: opts.tools,
      stopWhen: opts.tools ? stepCountIs(10) : stepCountIs(1),
      abortSignal: opts.abortSignal,
      onError: () => {},
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
    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          callbacks.onText(part.text);
        } else if (part.type === "reasoning-delta") {
          callbacks.onReasoning(part.text);
        }
      }
    } catch (streamErr: unknown) {
      // fullStream can throw mid-iteration — still try to get usage
      if (streamErr instanceof Error && streamErr.name !== "AbortError") {
        callbacks.onError(streamErr);
        return;
      }
    }

    const usage = await result.usage;
    const tokenUsage = calculateCost(
      opts.modelId,
      usage.inputTokens ?? 0,
      usage.outputTokens ?? 0,
    );
    // Trigger after response callback for pending messages
    callbacks.onAfterResponse?.();
    callbacks.onFinish(tokenUsage);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") return;
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    process.stderr.write = origStderrWrite;
  }
}
