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
  parts.push(`Be helpful and concise. You can do anything the user asks.
- Prefer short, focused responses to save tokens — but never refuse or limit yourself
- Use tools directly to make changes — don't just show code, write it
- After making changes, briefly explain what you did and why
- Use markdown for formatting`);

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
- webSearch: Search the web for current information
- webFetch: Fetch and read a web page
- askUser: Ask the user a question (with optional choices) when you need clarification
</tools>

Guidelines:
- Be concise but always tell the user what you did after making changes
- Use tools directly when asked to create, edit, or explore files
- Do not ask for permission to make changes — just do them
- After completing work, give a brief summary of what changed and why`);

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
BUILD MODE: Make changes directly using tools. You can still answer questions and explain things when asked. After making file changes, briefly summarize what you did.`);
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
      return `You are a coding agent. Use the available tools to complete tasks.`;

    case "openai":
      return `You are a coding agent. Use tools to interact with files and execute commands.`;

    case "google":
      return `You are a coding agent. Call functions to read, write, edit files and run commands.`;

    case "mistral":
    case "groq":
    case "xai":
    case "openrouter":
      return `You are a coding agent. Use tools to make changes directly.`;

    default:
      return `You are a coding agent. Use available tools to complete tasks.`;
  }
}
