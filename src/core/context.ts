import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import type { Mode, CavemanLevel } from "./config.js";

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

export function buildSystemPrompt(cwd: string, providerId?: string, mode?: Mode, cavemanLevel?: CavemanLevel): string {
  const cacheKey = `${providerId ?? "default"}:${mode ?? "build"}:${cavemanLevel ?? "off"}:${cwd}`;
  const cached = cachedPrompts.get(cacheKey);
  if (cached) return cached;

  const parts: string[] = [];

  // Core identity + behavioral guidelines (blended Pi + OpenCode style)
  parts.push(`You are a fast, helpful coding assistant running in the user's terminal. You're friendly, sharp, and direct.

<guidelines>
- For casual messages (greetings, chitchat, questions about yourself), respond naturally and conversationally. No tools needed. You have personality — be warm but brief.
- For coding tasks, use tools directly. Never just show code — write it to the file.
- Be concise. Short sentences. No filler. 1-2 sentence explanations after changes.
- Read before editing. Always read a file before modifying it.
- Use editFile for targeted changes. Only use writeFile for new files or complete rewrites.
- Verify after changes when possible — run tests or the build to catch errors.
- Follow existing patterns. Match the project's style, naming, and conventions.
- Do not re-read files already in context.
- Only explore the project when the task requires it. Do NOT list files unprompted.
- If a task is ambiguous, make a reasonable assumption and proceed. Use askUser for real decisions (preferences, destructive confirmations, choosing between options).
</guidelines>`);

  // Environment — minimal
  let isGit = false;
  try { execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" }); isGit = true; } catch {}

  parts.push(`<env>cwd: ${cwd} | git: ${isGit ? "yes" : "no"} | platform: ${process.platform}</env>`);

  // Per-tool guidelines — compact version when caveman is on
  if (cavemanLevel === "full" || cavemanLevel === "ultra") {
    parts.push(`<tool-tips>
bash: tests/builds/git/install. No cat/sed/grep. 30s timeout.
readFile: offset/limit for large files. Max 500 lines.
editFile: EXACT match old_string. Enough context for uniqueness.
writeFile: New files only. readFile first if exists.
listFiles: Explore code. Depth 3.
grep: Find defs/usages. Use include glob.
askUser: Only for user decisions.
todoWrite: Task checklist for 3+ step work.
</tool-tips>`);
  } else {
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
todoWrite: Create or update a task checklist for multi-step work. Use at the start of complex tasks (3+ steps) to show your plan, then update status as you complete each step. Helps the user track progress.
</tool-tips>`);
  }

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

  // Caveman mode — reduce output tokens by constraining verbosity
  if (cavemanLevel && cavemanLevel !== "off") {
    parts.push(getCavemanPrompt(cavemanLevel));
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

function getCavemanPrompt(level: CavemanLevel): string {
  if (level === "lite") {
    return `<output-style>
CONCISE MODE: Cut filler, pleasantries, and padding. No "Sure!", "Great question!", "Here's what I found:". Lead with the answer. Short sentences. One explanation line after changes, max. Code blocks unchanged. Technical terms exact.
</output-style>`;
  }
  if (level === "full") {
    return `<output-style>
TERSE MODE: Fragments OK. Drop articles (a/an/the). No filler words. No intros or signoffs. Just facts + code.
- Skip "I'll", "Let me", "Here's" — just do it
- 1 line explanations max. Often zero.
- Bullet points over paragraphs
- Code blocks unchanged, technical terms exact, error messages quoted exact
- Never apologize or hedge
</output-style>`;
  }
  // ultra
  return `<output-style>
TELEGRAPHIC MODE: Absolute minimum tokens. Write like a telegram.
- Drop articles, pronouns, conjunctions, prepositions when meaning survives
- Abbreviate: fn=function, arg=argument, ret=return, val=value, cfg=config, env=environment, dir=directory, dep=dependency, impl=implementation, msg=message, err=error, req=request, res=response
- No prose. Lists/fragments only. Max 5 words per point.
- Code blocks unchanged, technical terms exact
- "Fixed." not "I've fixed the issue in the file."
- "Added X to Y." not "I've gone ahead and added X to the Y file for you."
- Never explain what you're about to do. Just do it.
</output-style>`;
}
