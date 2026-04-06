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

  // Core identity — ultra-concise, saves tokens every single turn
  parts.push(`You are a coding agent. Use tools to complete tasks.
Be concise. Use tools directly — don't just show code, write it.
After changes, briefly explain what you did.
NEVER use askUser to clarify — make assumptions and proceed. Only use askUser for irreversible destructive actions.`);

  // Environment — minimal
  let isGit = false;
  try { execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" }); isGit = true; } catch {}

  parts.push(`<env>
cwd: ${cwd}
git: ${isGit ? "yes" : "no"}
platform: ${process.platform}
</env>`);

  // NO project file tree — saves hundreds of tokens per turn.
  // Model can use listFiles tool when it needs to explore.

  // Tool list — names only, descriptions are in the tool schemas already
  // This avoids duplicating what the AI SDK already sends
  parts.push(`Tools: readFile, writeFile, editFile, bash, listFiles, grep, webSearch, webFetch, askUser
Use listFiles to explore the project. Do not re-read files already in context.`);

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
