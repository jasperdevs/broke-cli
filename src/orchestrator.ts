import { streamText, type ModelMessage } from "ai";
import type { Provider, ModelInfo, TokenUsage } from "./providers/types.js";
import { buildContext } from "./context/builder.js";
import { buildUsage } from "./budget/cost.js";

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

export async function handleUserInput(
  input: string,
  history: ModelMessage[],
  config: OrchestratorConfig,
  callbacks: StreamCallbacks,
): Promise<{ messages: ModelMessage[] }> {
  const ctx = buildContext({
    history,
    userInput: input,
    cwd: process.cwd(),
  });

  let fullText = "";

  try {
    const result = streamText({
      model: config.provider.getModel(config.model.id),
      system: ctx.systemPrompt,
      messages: ctx.messages,
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

    // Get usage — handle case where stream produced text
    if (!fullText) {
      // Try to get any text from the result
      try {
        fullText = await result.text;
      } catch {
        // Stream may have errored
      }
    }

    if (!fullText) {
      callbacks.onError(new Error("No response received from the model. Check your API key and try again."));
      return { messages: ctx.messages };
    }

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

    const updatedMessages: ModelMessage[] = [
      ...ctx.messages,
      { role: "assistant" as const, content: fullText },
    ];

    return { messages: updatedMessages };
  } catch (err) {
    const raw = err instanceof Error ? err : new Error(String(err));
    // Improve common error messages
    let message = raw.message;
    if (message.includes("401")) {
      message = "Invalid API key. Check your key and try again.";
    } else if (message.includes("429")) {
      message = "Rate limited. Wait a moment and try again.";
    } else if (message.includes("403")) {
      message = "Access denied. Your API key may not have access to this model.";
    } else if (message.includes("ECONNREFUSED")) {
      message = "Cannot connect to the provider. Check your internet connection.";
    } else if (message.includes("No output generated")) {
      message = "No response from model. The model may be unavailable or your key may be invalid.";
    }
    callbacks.onError(new Error(message));
    return { messages: ctx.messages };
  }
}
