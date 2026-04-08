import type { LanguageModel } from "ai";
import { generateText } from "ai";
import { estimateConversationTokens } from "../ai/tokens.js";

const COMPACT_PROMPT = `Compress this conversation into a durable continuation frame for another coding agent.

Hard rules:
- Keep only actionable facts.
- Prefer exact file paths, errors, decisions, validation results, open problems, and next steps.
- Collapse repeated attempts into one final outcome.
- Never repeat greetings, filler, or full file contents.
- Mention abandoned branches only if they still matter.
- Output raw bullet lines only. No intro. No markdown heading prose.

Required sections in order:
- task:
- state:
- files:
- decisions:
- errors:
- verify:
- next:
`;

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

interface CompactOptions {
  customInstructions?: string;
  tailKeep?: number;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function collectInterestingLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(sure|okay|ok|thanks|thank you|got it|understood)[.!]*$/i.test(line))
    .slice(0, 6);
}

function dedupeConversation(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const deduped: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const content = normalizeText(message.content);
    if (!content) continue;
    const previous = deduped[deduped.length - 1];
    if (previous && previous.role === message.role && normalizeText(previous.content) === content) continue;
    deduped.push({ role: message.role, content });
  }
  return deduped;
}

function buildDeterministicSummary(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  customInstructions?: string,
): string {
  const task = messages.find((message) => message.role === "user")?.content ?? "continue the current task";
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const state = collectInterestingLines(lastAssistant).slice(0, 2);
  const next = collectInterestingLines(lastUser).slice(0, 2);
  const fileMatches = [...new Set(messages.flatMap((message) => (
    message.content.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? []
  )))].slice(0, 8);
  const errorLines = [...new Set(messages.flatMap((message) => (
    message.content.split(/\r?\n/).filter((line) => /(error|failed|exception|invalid|ENOENT|EINVAL|TypeError|ReferenceError)/i.test(line))
  )))].slice(0, 5);
  const decisionLines = [...new Set(messages.flatMap((message) => (
    message.content.split(/\r?\n/).filter((line) => /\b(decided|using|keep|remove|switched|route|prefer|default)\b/i.test(line))
  )))].slice(0, 5);
  const verifyLines = [...new Set(messages.flatMap((message) => (
    message.content.split(/\r?\n/).filter((line) => /\b(test|build|typecheck|lint|verified|passes|failed)\b/i.test(line))
  )))].slice(0, 5);
  const lines = [
    `- task: ${normalizeText(task).slice(0, 220)}`,
    `- state: ${state.join(" | ") || "recent state not captured"}`,
    `- files: ${fileMatches.length > 0 ? fileMatches.join(", ") : "none noted"}`,
    `- decisions: ${decisionLines.length > 0 ? decisionLines.map(normalizeText).join(" | ") : "none noted"}`,
    `- errors: ${errorLines.length > 0 ? errorLines.map(normalizeText).join(" | ") : "none"}`,
    `- verify: ${verifyLines.length > 0 ? verifyLines.map(normalizeText).join(" | ") : "not yet run"}`,
    `- next: ${next.join(" | ") || "continue from the latest active branch"}`,
  ];
  if (customInstructions?.trim()) lines.push(`- focus: ${normalizeText(customInstructions).slice(0, 220)}`);
  return lines.join("\n");
}

async function generateCompactionSummary(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: LanguageModel,
  customInstructions?: string,
): Promise<string> {
  const conversationText = messages
    .map((message) => `${message.role}: ${message.content.slice(0, 700)}`)
    .join("\n\n");
  const system = customInstructions?.trim()
    ? `${COMPACT_PROMPT}\nFollow this extra focus instruction: ${customInstructions.trim()}`
    : COMPACT_PROMPT;
  const result = await generateText({
    model,
    system,
    prompt: conversationText,
    maxOutputTokens: 700,
  });
  return result.text.trim();
}

export function buildCompactionContextMessage(summary: string): string {
  return `${COMPACTION_SUMMARY_PREFIX}${summary.trim()}${COMPACTION_SUMMARY_SUFFIX}`;
}

export function splitCompactedMessages(
  messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>,
): {
  summary: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
} {
  const first = messages[0];
  if (first?.role !== "user") return { summary: null, messages };
  if (!first.content.startsWith(COMPACTION_SUMMARY_PREFIX) || !first.content.endsWith(COMPACTION_SUMMARY_SUFFIX)) {
    return { summary: null, messages };
  }
  return {
    summary: first.content.slice(COMPACTION_SUMMARY_PREFIX.length, -COMPACTION_SUMMARY_SUFFIX.length).trim(),
    messages: messages.slice(1),
  };
}

export async function compactMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: LanguageModel,
  options: CompactOptions = {},
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const parsed = splitCompactedMessages(messages);
  const normalized = dedupeConversation(parsed.summary
    ? [{ role: "user" as const, content: `Previously compacted summary:\n${parsed.summary}` }, ...parsed.messages]
    : messages);
  const tailKeep = Math.max(3, options.tailKeep ?? 6);
  if (normalized.length <= tailKeep) return normalized;

  const toSummarize = normalized.slice(0, -tailKeep);
  const toKeep = normalized.slice(-tailKeep);
  const summarizeTokens = estimateConversationTokens("", toSummarize, "compaction");
  if (summarizeTokens <= 12000) {
    return [
      { role: "user" as const, content: buildCompactionContextMessage(buildDeterministicSummary(toSummarize, options.customInstructions)) },
      ...toKeep,
    ];
  }

  try {
    const summary = await generateCompactionSummary(toSummarize, model, options.customInstructions);
    return [
      { role: "user" as const, content: buildCompactionContextMessage(summary) },
      ...toKeep,
    ];
  } catch {
    return [
      { role: "user" as const, content: buildCompactionContextMessage(buildDeterministicSummary(toSummarize, options.customInstructions)) },
      ...toKeep,
    ];
  }
}

export async function summarizeBranchMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model?: LanguageModel | null,
  customInstructions?: string,
): Promise<string> {
  const normalized = dedupeConversation(messages);
  if (normalized.length === 0) return "No abandoned branch state to summarize.";
  if (!model) return buildDeterministicSummary(normalized, customInstructions);
  try {
    return await generateCompactionSummary(normalized, model, customInstructions);
  } catch {
    return buildDeterministicSummary(normalized, customInstructions);
  }
}

export function getTotalContextTokens(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  modelId?: string,
): number {
  return estimateConversationTokens(
    systemPrompt,
    messages
      .filter((m): m is { role: "user" | "assistant"; content: string } => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content })),
    modelId,
  );
}
