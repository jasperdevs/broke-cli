/** Permission level for a tool */
export type PermissionLevel = "safe" | "guarded" | "dangerous";

/** Result of a permission check */
export interface PermissionCheck {
  allowed: boolean;
  /** If not allowed, why */
  reason?: string;
  /** Whether to show a diff/preview before executing */
  requiresReview: boolean;
}

/** A git checkpoint for undo support */
export interface GitCheckpoint {
  ref: string;
  timestamp: Date;
  description: string;
  files: string[];
}

/** Dangerous bash patterns to detect */
export interface BashPattern {
  pattern: RegExp;
  severity: "warn" | "block";
  description: string;
}
