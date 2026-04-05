import { streamText, type StreamTextResult, type ModelMessage } from "ai";
import type { Provider, ModelInfo, TokenUsage } from "./providers/types.js";
import { buildContext } from "./context/builder.js";
import { buildUsage, formatCost } from "./budget/cost.js";

export interface OrchestratorConfig {
  provider: Provider;
  model: ModelInfo;
}

export interface StreamCallbacks {
  onText: (text: string) => void;
  onReasoning?: (text: string) => void;
  onError: (error: Error) => void;
  onUsage: (usage: TokenUsage) => void;
  onFinish: (fullText: string, usage: TokenUsage) => void;
}

/**
 * Orchestrator: coordinates a single request lifecycle.
 * Phase 1: simple chat. Phase 2 adds tools + agent loop.
 */
export async function handleUserInput(
  input: string,
  history: ModelMessage[],
  config: OrchestratorConfig,
  callbacks: StreamCallbacks,
): Promise<{ messages: ModelMessage[] }> {
  // 1. Build context
  const ctx = buildContext({
    history,
    userInput: input,
    cwd: process.cwd(),
  });

  // 2. Stream the response
  let fullText = "";

  try {
    const result = streamText({
      model: config.provider.getModel(config.model.id),
      system: ctx.systemPrompt,
      messages: ctx.messages,
      // Phase 2: tools, stopWhen
      // Phase 3: providerOptions for prompt caching
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text":
          fullText += part.text;
          callbacks.onText(part.text);
          break;
        case "reasoning":
          callbacks.onReasoning?.(part.text);
          break;
        case "error":
          callbacks.onError(
            part.error instanceof Error
              ? part.error
              : new Error(String(part.error)),
          );
          break;
      }
    }

    // 3. Get usage
    const rawUsage = await result.usage;
    const usage = buildUsage(
      config.model.pricing,
      rawUsage.inputTokens,
      rawUsage.outputTokens,
      (rawUsage as { inputTokenDetails?: { cachedTokens?: number } })
        .inputTokenDetails?.cachedTokens ?? 0,
    );

    callbacks.onUsage(usage);
    callbacks.onFinish(fullText, usage);

    // 4. Return updated messages for session history
    const updatedMessages: ModelMessage[] = [
      ...ctx.messages,
      { role: "assistant" as const, content: fullText },
    ];

    return { messages: updatedMessages };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    callbacks.onError(error);
    return { messages: ctx.messages };
  }
}
