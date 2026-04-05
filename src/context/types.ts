import type { ModelMessage } from "ai";

/** A message in our internal format (wraps AI SDK's ModelMessage) */
export type Message = ModelMessage;

/** A reducer transforms a message array to reduce token usage */
export type MessageReducer = (
  messages: Message[],
  config: ReducerConfig,
) => Message[] | Promise<Message[]>;

/** Config passed to each reducer */
export interface ReducerConfig {
  /** Max lines to keep from tool output */
  maxOutputLines: number;
  /** Whether to strip verbose markdown from assistant messages */
  reduceVerbosity: boolean;
  /** Model's context window size */
  contextWindow: number;
  /** Current estimated token count */
  estimatedTokens: number;
  /** Threshold (0-1) at which to trigger compaction */
  compactionThreshold: number;
}

/** Result of building context for an LLM call */
export interface BuiltContext {
  messages: Message[];
  systemPrompt: string;
  estimatedTokens: number;
  wasCompacted: boolean;
}
