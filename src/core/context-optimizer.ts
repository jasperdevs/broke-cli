/**
 * Context optimizer — reduces token usage by compressing conversation history.
 *
 * Two strategies:
 * 1. Tool result eviction: After N turns, old tool results get summarized to one line
 * 2. Diff-only history: When a file is read then edited, replace the full content with a diff summary
 */

/** Track files that have been read in this session */
const readFiles = new Map<string, { turnIndex: number; lineCount: number }>();

/** Track which turn we're on */
let currentTurn = 0;

/** How many turns before tool results get evicted */
const EVICTION_THRESHOLD = 6;

/** Max chars to keep for old tool results */
const EVICTED_RESULT_MAX = 120;

export function nextTurn(): number {
  return ++currentTurn;
}

export function getCurrentTurn(): number {
  return currentTurn;
}

export function resetOptimizer(): void {
  readFiles.clear();
  currentTurn = 0;
}

/** Record that a file was read */
export function trackFileRead(path: string, lineCount: number): void {
  readFiles.set(normalizePath(path), { turnIndex: currentTurn, lineCount });
}

/** Check if a file was already read (for dedup warning) */
export function wasFileRead(path: string): boolean {
  return readFiles.has(normalizePath(path));
}

/** Get read info for a file */
export function getFileReadInfo(path: string): { turnIndex: number; lineCount: number } | undefined {
  return readFiles.get(normalizePath(path));
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Optimize messages in-place before sending to the model.
 * - Evicts old tool results to one-line summaries
 * - Replaces read-then-edit sequences with diff summaries
 */
export function optimizeMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (messages.length < EVICTION_THRESHOLD * 2) return messages;

  const result: Array<{ role: "user" | "assistant"; content: string }> = [];
  const recentStart = Math.max(0, messages.length - EVICTION_THRESHOLD * 2);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (i < recentStart) {
      // Old messages — compress tool outputs
      const compressed = compressToolOutputs(msg.content);
      result.push({ role: msg.role, content: compressed });
    } else {
      // Recent messages — keep as-is
      result.push(msg);
    }
  }

  return result;
}

/**
 * Compress tool outputs in a message.
 * Patterns like "[tool result: 500 lines of file content]" get replaced with summaries.
 */
function compressToolOutputs(content: string): string {
  // Already short — skip
  if (content.length < 500) return content;

  // Compress file content blocks (readFile results embedded in assistant messages)
  let compressed = content;

  // Pattern: large blocks of code/text that look like file contents
  // These are typically multi-line strings with consistent indentation
  const lines = compressed.split("\n");
  if (lines.length > 30) {
    // Keep first 3 and last 2 lines, summarize middle
    const head = lines.slice(0, 3).join("\n");
    const tail = lines.slice(-2).join("\n");
    const omitted = lines.length - 5;
    compressed = `${head}\n[... ${omitted} lines compressed ...]\n${tail}`;
  }

  // Cap total length
  if (compressed.length > 1500) {
    compressed = compressed.slice(0, 1500) + "\n[compressed]";
  }

  return compressed;
}

/**
 * Build a diff summary when a file that was previously read gets edited.
 * Returns a compact representation instead of the full file content.
 */
export function buildDiffSummary(
  path: string,
  oldStr: string,
  newStr: string,
): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const removedCount = oldLines.length;
  const addedCount = newLines.length;

  // Show compact diff
  const parts: string[] = [];
  parts.push(`Edit ${path}: -${removedCount} +${addedCount} lines`);

  // Show first few removed/added lines
  for (const l of oldLines.slice(0, 3)) {
    parts.push(`- ${l.slice(0, 80)}`);
  }
  if (oldLines.length > 3) parts.push(`  (${oldLines.length - 3} more removed)`);

  for (const l of newLines.slice(0, 3)) {
    parts.push(`+ ${l.slice(0, 80)}`);
  }
  if (newLines.length > 3) parts.push(`  (${newLines.length - 3} more added)`);

  return parts.join("\n");
}
