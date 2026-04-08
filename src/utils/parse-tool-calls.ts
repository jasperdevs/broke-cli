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
  writeFileObject: /writeFile\s*\{\s*([\s\S]*?)\s*\}/g,
  editFile: /editFile\s*\(\s*(["'`])(.+?)\1\s*,\s*(["'`])([\s\S]*?)\3\s*,\s*(["'`])([\s\S]*?)\5\s*\)/g,
  editFileObject: /editFile\s*\{\s*([\s\S]*?)\s*\}/g,
  readFile: /readFile\s*\(\s*(["'`])(.+?)\1\s*\)/g,
  readFileObject: /readFile\s*\{\s*([\s\S]*?)\s*\}/g,
  listFiles: /listFiles\s*\(\s*(["'`])?(.+?)\1?\s*\)/g,
  listFilesObject: /listFiles\s*\{\s*([\s\S]*?)\s*\}/g,
  grep: /grep\s*\(\s*(["'`])(.+?)\1\s*(,\s*(["'`])?(.+?)\4?)?\s*\)/g,
  grepObject: /grep\s*\{\s*([\s\S]*?)\s*\}/g,
  bash: /bash\s*\(\s*(["'`])([\s\S]*?)\1\s*\)/g,
  bashObject: /bash\s*\{\s*([\s\S]*?)\s*\}/g,
};

function parseObjectArgs(raw: string): Record<string, string> {
  const args: Record<string, string> = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(["'`])([\s\S]*?)\2/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    args[match[1]] = match[3];
  }
  return args;
}

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
        calls.push({ name: "writeFile", args: { path, content }, raw });
      } else if (name === "writeFileObject") {
        const obj = parseObjectArgs(match[1]);
        calls.push({ name: "writeFile", args: { path: obj.path, content: obj.content }, raw });
      } else if (name === "editFile") {
        const path = match[2];
        const oldStr = match[4];
        const newStr = match[6];
        calls.push({ name: "editFile", args: { path, old_string: oldStr, new_string: newStr }, raw });
      } else if (name === "editFileObject") {
        const obj = parseObjectArgs(match[1]);
        calls.push({ name: "editFile", args: { path: obj.path, old_string: obj.old_string ?? obj.oldString, new_string: obj.new_string ?? obj.newString }, raw });
      } else if (name === "readFile") {
        const path = match[2];
        calls.push({ name: "readFile", args: { path }, raw });
      } else if (name === "readFileObject") {
        const obj = parseObjectArgs(match[1]);
        calls.push({ name: "readFile", args: { path: obj.path }, raw });
      } else if (name === "listFiles") {
        const path = match[2] || ".";
        calls.push({ name: "listFiles", args: { path }, raw });
      } else if (name === "listFilesObject") {
        const obj = parseObjectArgs(match[1]);
        calls.push({ name: "listFiles", args: { path: obj.path || "." }, raw });
      } else if (name === "grep") {
        const pattern = match[2];
        const path = match[5] || ".";
        calls.push({ name: "grep", args: { pattern, path }, raw });
      } else if (name === "grepObject") {
        const obj = parseObjectArgs(match[1]);
        calls.push({ name: "grep", args: { pattern: obj.pattern, path: obj.path || "." }, raw });
      } else if (name === "bash") {
        const command = match[2];
        calls.push({ name: "bash", args: { command }, raw });
      } else if (name === "bashObject") {
        const obj = parseObjectArgs(match[1]);
        calls.push({ name: "bash", args: { command: obj.command }, raw });
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
