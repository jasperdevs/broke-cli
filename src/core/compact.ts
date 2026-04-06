import type { LanguageModel } from "ai";
import { generateText } from "ai";

const COMPACT_PROMPT = `Summarize this conversation into a concise context block.
Keep: key decisions, file paths mentioned, code changes made, current task state.
Drop: pleasantries, repeated explanations, verbose tool outputs.
Output a single paragraph that another AI can use to continue the conversation.`;

export async function compactMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: LanguageModel,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  if (messages.length < 6) return messages;

  // Keep last 4 messages, summarize the rest
  const toSummarize = messages.slice(0, -4);
  const toKeep = messages.slice(-4);

  const conversationText = toSummarize
    .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
    .join("\n\n");

  try {
    const result = await generateText({
      model,
      system: COMPACT_PROMPT,
      prompt: conversationText,
      maxOutputTokens: 500,
    });

    return [
      { role: "user" as const, content: `[Context from earlier conversation]\n${result.text}` },
      ...toKeep,
    ];
  } catch {
    // Fallback: just truncate old messages
    return messages.slice(-6);
  }
}

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

export function getTotalContextTokens(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
): number {
  let total = estimateTokens(systemPrompt);
  for (const m of messages) {
    total += estimateTokens(m.content) + 4; // 4 tokens overhead per message
  }
  return total;
}
