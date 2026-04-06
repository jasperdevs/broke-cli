/**
 * Parse tool calls from text output (for models that don't support function calling)
 * Detects patterns like: writeFile("path", "content") or readFile("path")
 */

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
  raw: string;
}

const TOOL_PATTERNS: Record<string, RegExp> = {
  writeFile: /writeFile\s*\(\s*(["'`])(.+?)\1\s*,\s*(["'`])([\s\S]*?)\3\s*\)/g,
  editFile: /editFile\s*\(\s*(["'`])(.+?)\1\s*,\s*(["'`])([\s\S]*?)\3\s*,\s*(["'`])([\s\S]*?)\5\s*\)/g,
  readFile: /readFile\s*\(\s*(["'`])(.+?)\1\s*\)/g,
  listFiles: /listFiles\s*\(\s*(["'`])?(.+?)\1?\s*\)/g,
  grep: /grep\s*\(\s*(["'`])(.+?)\1\s*(,\s*(["'`])?(.+?)\4?)?\s*\)/g,
  bash: /bash\s*\(\s*(["'`])([\s\S]*?)\1\s*\)/g,
};

export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  for (const [name, pattern] of Object.entries(TOOL_PATTERNS)) {
    pattern.lastIndex = 0; // Reset regex state
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      
      if (name === "writeFile") {
        const path = match[2];
        const content = match[4];
        calls.push({ name, args: { path, content }, raw });
      } else if (name === "editFile") {
        const path = match[2];
        const oldStr = match[4];
        const newStr = match[6];
        calls.push({ name, args: { path, oldString: oldStr, newString: newStr }, raw });
      } else if (name === "readFile") {
        const path = match[2];
        calls.push({ name, args: { path }, raw });
      } else if (name === "listFiles") {
        const path = match[2] || ".";
        calls.push({ name, args: { path }, raw });
      } else if (name === "grep") {
        const pattern = match[2];
        const path = match[5] || ".";
        calls.push({ name, args: { pattern, path }, raw });
      } else if (name === "bash") {
        const command = match[2];
        calls.push({ name, args: { command }, raw });
      }
    }
  }

  return calls;
}

/**
 * Check if text looks like it contains tool calls that weren't executed
 */
export function hasUnexecutedToolCalls(text: string): boolean {
  // Look for patterns like: writeFile("...", "...") on its own line
  const patterns = [
    /^\s*(writeFile|editFile|readFile|listFiles|grep|bash)\s*\(/gm,
  ];
  return patterns.some(p => p.test(text));
}