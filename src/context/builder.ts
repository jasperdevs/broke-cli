import type { ModelMessage } from "ai";
import type { BuiltContext } from "./types.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { loadConventions } from "../conventions/loader.js";

interface BuildContextOptions {
  history: ModelMessage[];
  userInput: string;
  cwd: string;
}

/**
 * Build the context for an LLM call.
 * Phase 1: simple assembly. Phase 3 adds the reducer pipeline.
 */
export function buildContext(opts: BuildContextOptions): BuiltContext {
  const rulesContent = loadConventions(opts.cwd);
  const systemPrompt = buildSystemPrompt({
    cwd: opts.cwd,
    rulesContent: rulesContent || undefined,
  });

  const messages: ModelMessage[] = [
    ...opts.history,
    { role: "user", content: opts.userInput },
  ];

  return {
    messages,
    systemPrompt,
    estimatedTokens: 0, // Phase 3: real token counting
    wasCompacted: false,
  };
}
