import type { LanguageModel } from "ai";
import { generateText } from "ai";

const COMPACT_PROMPT = `Compress this conversation into a minimal context block for another AI to continue.

KEEP (exact values):
- File paths modified/read and what changed
- Current task state and next steps
- Key decisions made and constraints
- Error messages encountered
- Code patterns established

DROP:
- Greetings, acknowledgments, explanations of what tools do
- Verbose tool outputs (just note "read file X, 200 lines")
- Repeated attempts at the same thing (just note final outcome)
- Full file contents (just note path + summary)

Format: dense bullet points. No prose. Every line should be actionable context.`;

export async function compactMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: LanguageModel,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  if (messages.length < 6) return messages;

  // Keep last 4 messages, summarize the rest
  const toSummarize = messages.slice(0, -4);
  const toKeep = messages.slice(-4);

  // Truncate each message to avoid blowing up the compaction request itself
  const conversationText = toSummarize
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
    .join("\n\n");

  try {
    const result = await generateText({
      model,
      system: COMPACT_PROMPT,
      prompt: conversationText,
      maxOutputTokens: 600,
    });

    return [
      { role: "user" as const, content: `[Compacted context]\n${result.text}` },
      ...toKeep,
    ];
  } catch {
    // Fallback: just truncate old messages
    return messages.slice(-6);
  }
}

export function estimateTokens(text: string): number {
  // ~4 chars per token for English
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
