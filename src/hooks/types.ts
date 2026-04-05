/** Events that can trigger lifecycle hooks */
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "SessionEnd"
  | "PostResponse"
  | "BudgetWarning";

/** Data passed to a hook via stdin */
export interface HookInput {
  event: HookEvent;
  /** Tool name (for PreToolUse/PostToolUse) */
  tool?: string;
  /** Tool arguments (for PreToolUse) */
  toolArgs?: Record<string, unknown>;
  /** Tool result (for PostToolUse) */
  toolResult?: unknown;
  /** Session ID */
  sessionId?: string;
  /** Current spend (for BudgetWarning) */
  spend?: number;
}

/** Response from a hook via stdout */
export interface HookOutput {
  /** Override tool args (PreToolUse only) */
  modifiedArgs?: Record<string, unknown>;
  /** Additional context to inject */
  context?: string;
}

/** Hook handler result based on exit code */
export interface HookResult {
  /** Exit code 0 = continue, 2 = block */
  action: "continue" | "block";
  output?: HookOutput;
}
