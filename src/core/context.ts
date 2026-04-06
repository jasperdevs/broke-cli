import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import type { Mode } from "./config.js";

const CONVENTION_FILES = [
  "CONVENTIONS.md",
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
];

const GLOBAL_CONTEXT_DIR = join(homedir(), ".brokecli");

/** Max tokens to spend on convention file contents */
const MAX_CONVENTION_CHARS = 3200; // ~800 tokens

let cachedPrompts = new Map<string, string>();

export function buildSystemPrompt(cwd: string, providerId?: string, mode?: Mode): string {
  const cacheKey = `${providerId ?? "default"}:${mode ?? "build"}:${cwd}`;
  const cached = cachedPrompts.get(cacheKey);
  if (cached) return cached;

  const parts: string[] = [];

  // Core identity + behavioral guidelines (blended Pi + OpenCode style)
  parts.push(`You are a coding agent operating in the user's terminal. You solve tasks by using tools directly.

<guidelines>
- ALWAYS use tools to make changes. Never just show code — write it to the file.
- Be extremely concise. Short sentences. No filler, no preamble. 1-2 sentence explanations after changes.
- Read before editing. Always read a file before modifying it.
- Make targeted edits. Use editFile for surgical changes. Only use writeFile for new files or complete rewrites.
- Verify after changes. Run tests or the build after modifying code to catch errors early.
- Follow existing patterns. Match the project's style, naming, indentation, and conventions.
- Do not re-read files already shown in conversation context.
- Only explore the project when the task requires it. Do NOT list files or read code unprompted.
- If a task is ambiguous, make a reasonable assumption and proceed. Use askUser when you need user input (choosing between options, confirming destructive actions, getting preferences).
- For casual messages (greetings, questions), just respond naturally. No tools needed.
</guidelines>`);

  // Environment — minimal
  let isGit = false;
  try { execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" }); isGit = true; } catch {}

  parts.push(`<env>cwd: ${cwd} | git: ${isGit ? "yes" : "no"} | platform: ${process.platform}</env>`);

  // Per-tool guidelines (Pi style — concise tips in system prompt, not duplicating tool schemas)
  parts.push(`<tool-tips>
bash: Use for running tests, builds, git commands, installing packages. Prefer tools over bash for file operations (don't cat/sed/grep via bash). Commands timeout at 30s by default.
readFile: Use offset/limit for large files — don't read entire files over 500 lines.
editFile: old_string must be an EXACT match of existing text. Include enough surrounding context to be unique. Prefer this over writeFile for changes.
writeFile: For new files or complete rewrites only. Always readFile first if the file exists.
listFiles: Start here when exploring unfamiliar code. Default depth is 3.
grep: For finding definitions, usages, patterns across the codebase. Use include glob to narrow search.
webSearch: For current docs, APIs, recent events. Not for things you already know.
webFetch: For reading specific URLs — docs pages, API references. Content is stripped of HTML.
askUser: Use when you need the user's preference or decision. Good for: "which color?", "option A or B?", "delete these files?". Not for: things you can figure out yourself.
</tool-tips>`);

  // Global context files (truncated)
  for (const file of ["AGENTS.md", "SYSTEM.md"]) {
    const path = join(GLOBAL_CONTEXT_DIR, file);
    if (existsSync(path)) {
      try {
        let content = readFileSync(path, "utf-8").trim();
        if (content) {
          if (content.length > MAX_CONVENTION_CHARS) {
            content = content.slice(0, MAX_CONVENTION_CHARS) + "\n[truncated]";
          }
          parts.push(`--- ${file} ---\n${content}`);
        }
      } catch { /* skip */ }
    }
  }

  // Walk up directory tree for convention files (truncated)
  const seen = new Set<string>();
  let dir = cwd;
  const home = homedir();
  while (dir !== dirname(dir) && dir !== home) {
    for (const file of CONVENTION_FILES) {
      const path = join(dir, file);
      if (!seen.has(file) && existsSync(path)) {
        try {
          let content = readFileSync(path, "utf-8").trim();
          if (content) {
            if (content.length > MAX_CONVENTION_CHARS) {
              content = content.slice(0, MAX_CONVENTION_CHARS) + "\n[truncated]";
            }
            parts.push(`--- ${file} ---\n${content}`);
            seen.add(file);
          }
        } catch { /* skip */ }
      }
    }
    dir = dirname(dir);
  }

  // Mode — one line
  if (mode === "plan") {
    parts.push(`MODE: plan — read first, outline steps, wait for confirmation.`);
  } else {
    parts.push(`MODE: build — make changes directly with tools.`);
  }

  const prompt = parts.join("\n");
  cachedPrompts.set(cacheKey, prompt);
  return prompt;
}

export function reloadContext(): void {
  cachedPrompts.clear();
}
