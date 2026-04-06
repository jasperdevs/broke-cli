import { readFileSync, existsSync, readdirSync } from "fs";
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

let cachedPrompts = new Map<string, string>();

export function buildSystemPrompt(cwd: string, providerId?: string, mode?: Mode): string {
  const cacheKey = `${providerId ?? "default"}:${mode ?? "build"}:${cwd}`;
  const cached = cachedPrompts.get(cacheKey);
  if (cached) return cached;

  const parts: string[] = [];

  // Core identity — provider-specific instructions
  parts.push(getProviderPrompt(providerId));
  parts.push(`EXTREME BREVITY: Every token costs money. Be maximally concise.
- Use short sentences. Delete unnecessary words.
- No greetings, no "Here's the code:", no "As you can see"
- No markdown unless explicitly asked
- Code only: show the code, nothing else
- Errors only: state the error, one line fix
- One word answers when possible`);

  // Environment info (like OpenCode does)
  let isGit = false;
  try { execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" }); isGit = true; } catch {}

  parts.push(`
<env>
Working directory: ${cwd}
Is git repo: ${isGit ? "yes" : "no"}
Platform: ${process.platform}
Date: ${new Date().toDateString()}
</env>`);

  // Project file tree (like OpenCode includes)
  try {
    let tree: string;
    if (isGit) {
      const files = execSync("git ls-files --others --cached --exclude-standard", { cwd, encoding: "utf-8", timeout: 3000 }).trim();
      tree = files.split("\n").slice(0, 100).join("\n");
    } else {
      tree = listProjectFiles(cwd, 100);
    }
    if (tree) {
      parts.push(`
<project>
${tree}
</project>`);
    }
  } catch { /* skip */ }

  // Tool capabilities
  parts.push(`
<tools>
- readFile: Read file contents
- writeFile: Create or overwrite files  
- editFile: Find and replace in files
- bash: Execute shell commands
- listFiles: List directory contents
- grep: Search file contents
</tools>

Guidelines:
- Be concise
- Use tools directly when asked to create, edit, or explore files
- Do not ask for permission to make changes
- Do not show code in responses - use the tools instead`);

  // Global context
  for (const file of ["AGENTS.md", "SYSTEM.md"]) {
    const path = join(GLOBAL_CONTEXT_DIR, file);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8").trim();
        if (content) parts.push(`\n--- Global: ${file} ---\n${content}`);
      } catch { /* skip */ }
    }
  }

  // Walk up directory tree for convention files
  const seen = new Set<string>();
  let dir = cwd;
  const home = homedir();
  while (dir !== dirname(dir) && dir !== home) {
    for (const file of CONVENTION_FILES) {
      const path = join(dir, file);
      if (!seen.has(file) && existsSync(path)) {
        try {
          const content = readFileSync(path, "utf-8").trim();
          if (content) {
            parts.push(`\n--- ${file} ---\n${content}`);
            seen.add(file);
          }
        } catch { /* skip */ }
      }
    }
    dir = dirname(dir);
  }

  // Mode-specific instructions
  if (mode === "plan") {
    parts.push(`
PLAN MODE: Read first. Plan: 1) step 2) step 3) step. Wait for confirmation.`);
  } else {
    parts.push(`
BUILD MODE: Execute. No asking. Just do it.`);
  }

  const prompt = parts.join("\n");
  cachedPrompts.set(cacheKey, prompt);
  return prompt;
}

function listProjectFiles(cwd: string, limit: number): string {
  const files: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__"]);

  function walk(dir: string, depth: number) {
    if (depth > 4 || files.length >= limit) return;
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(".") || skip.has(entry)) continue;
        const full = join(dir, entry);
        try {
          const stat = require("fs").statSync(full);
          if (stat.isDirectory()) walk(full, depth + 1);
          else files.push(full.replace(cwd + "/", "").replace(cwd + "\\", ""));
        } catch {}
        if (files.length >= limit) return;
      }
    } catch {}
  }

  walk(cwd, 0);
  return files.join("\n");
}

export function reloadContext(): void {
  cachedPrompts.clear();
}

/** Provider-specific system prompt preamble */
function getProviderPrompt(providerId?: string): string {
  switch (providerId) {
    case "anthropic":
      return `You are pi, a coding agent. Use the available tools to complete tasks.`;

    case "openai":
    case "codex":
      return `You are pi, a coding agent. Use tools to interact with files and execute commands.`;

    case "google":
      return `You are pi, a coding agent. Call functions to read, write, edit files and run commands.`;

    case "mistral":
    case "groq":
    case "xai":
    case "openrouter":
      return `You are pi, a coding agent. Use tools to make changes directly.`;

    default:
      return `You are pi, a coding agent. Use available tools to complete tasks.`;
  }
}
