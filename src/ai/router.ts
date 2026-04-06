/**
 * Smart model router — automatically picks the cheapest model capable of handling a task.
 *
 * Strategy:
 * - Tool-only turns (file reads, grep, listFiles) → small model
 * - Simple questions / short responses → small model
 * - Complex reasoning, refactoring, architecture → main model
 * - If no small model configured, always use main model
 */

import type { LanguageModel } from "ai";

/** Known cheap models per provider */
const SMALL_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  codex: "gpt-4o-mini",
  google: "gemini-2.0-flash",
  groq: "llama-3.1-8b-instant",
  mistral: "mistral-small-latest",
  xai: "grok-3-mini",
};

export interface RouterConfig {
  mainModel: LanguageModel;
  smallModel: LanguageModel | null;
  mainModelId: string;
  smallModelId: string;
  providerId: string;
}

export type RouteDecision = "main" | "small";

/**
 * Decide which model to use for a given turn.
 * Returns "small" for exploration/simple tasks, "main" for reasoning.
 */
export function routeMessage(
  userMessage: string,
  messageCount: number,
  lastToolCalls: string[],
): RouteDecision {
  const msg = userMessage.toLowerCase().trim();

  // First message always goes to main model (needs full context understanding)
  if (messageCount <= 1) return "main";

  // Explicit complexity signals → main model
  const complexPatterns = [
    /refactor/i, /rewrite/i, /implement/i, /build/i, /create/i, /design/i,
    /architect/i, /optimize/i, /debug/i, /fix.*bug/i, /why.*not.*work/i,
    /explain.*how/i, /what.*wrong/i, /review/i, /plan/i,
    /migrate/i, /convert/i, /upgrade/i, /integrate/i,
  ];
  for (const p of complexPatterns) {
    if (p.test(msg)) return "main";
  }

  // Long messages likely need reasoning
  if (msg.length > 300) return "main";

  // Simple exploration patterns → small model
  const simplePatterns = [
    /^(read|show|cat|look at|open|view|what('s| is) in)\b/i,
    /^(list|ls|find|search|grep|where)\b/i,
    /^(run|exec|execute)\b/i,
    /^(check|test|verify)\b/i,
    /^(what|which) (file|dir|folder)/i,
    /^(how many|count)/i,
  ];
  for (const p of simplePatterns) {
    if (p.test(msg)) return "small";
  }

  // Short simple messages → small model
  if (msg.length < 50 && !msg.includes("?")) return "small";

  // If last turn was tool-heavy (3+ tool calls), follow-up is likely simple
  if (lastToolCalls.length >= 3) return "small";

  // Default to main model for safety
  return "main";
}

/** Get the default small model ID for a provider */
export function getSmallModelId(providerId: string): string | undefined {
  return SMALL_MODELS[providerId];
}
