import { encodingForModel, getEncoding } from "js-tiktoken";

type MessageContent = string | Array<{ type: "text"; text: string } | { type: "image"; image: string }>;

const encoderCache = new Map<string, ReturnType<typeof getEncoding>>();

function getEncoder(modelId?: string) {
  const key = modelId || "cl100k_base";
  const cached = encoderCache.get(key);
  if (cached) return cached;

  try {
    const encoder = modelId ? encodingForModel(modelId as Parameters<typeof encodingForModel>[0]) : getEncoding("cl100k_base");
    encoderCache.set(key, encoder);
    return encoder;
  } catch {
    const fallback = getEncoding("cl100k_base");
    encoderCache.set(key, fallback);
    return fallback;
  }
}

export function estimateTextTokens(text: string, modelId?: string): number {
  if (!text) return 0;
  try {
    return getEncoder(modelId).encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function estimateConversationTokens(
  system: string,
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
  modelId?: string,
): number {
  let total = estimateTextTokens(system, modelId);
  for (const message of messages) {
    if (typeof message.content === "string") {
      total += estimateTextTokens(message.content, modelId) + 4;
      continue;
    }

    for (const part of message.content) {
      if (part.type === "text") {
        total += estimateTextTokens(part.text, modelId);
      } else {
        total += 256;
      }
    }
    total += 4;
  }
  return total;
}
