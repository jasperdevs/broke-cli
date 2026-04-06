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
  parts.push(`Be concise and direct. Lead with the answer, not the reasoning.
When writing code, write complete implementations. Do not leave TODOs or placeholders.`);

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
You have access to these tools:
- bash: Execute shell commands. Use for running tests, builds, git operations, package management.
- readFile: Read file contents by path.
- writeFile: Create or overwrite a file with new content.
- editFile: Find and replace a specific string in a file.
- listFiles: List files in a directory recursively.
- grep: Search for a regex pattern across files.

When the user asks you to make changes, use the tools to implement them directly.
Do not just describe what to do - actually do it using the tools.
</tools>`);

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
    parts.push(`\nPLAN MODE: Read and analyze first. Present a plan with numbered steps. Ask for confirmation before making changes. Do not write files without approval.`);
  } else {
    parts.push(`\nBUILD MODE: Execute immediately. Make changes directly. Do not ask for permission.`);
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

/** Provider-specific system prompt preamble (like OpenCode does) */
function getProviderPrompt(providerId?: string): string {
  switch (providerId) {
    case "anthropic":
      return `You are a coding agent. Use the available tools to complete tasks.

When asked to write or edit code: use writeFile or editFile directly. Do not describe the code first.
When exploring code: use readFile, grep, and listFiles.
When running commands: use bash.
Be direct. Make changes immediately. Do not ask for permission.`;

    case "openai":
    case "codex":
      return `You are a coding agent with filesystem access. Use tools to complete tasks.

Use writeFile to create files. Use editFile to modify files. Use bash for commands.
Do not output code in messages - use the tools instead.
Do not ask for confirmation. Just make the changes.`;

    case "google":
      return `You are a coding agent. Use function calls to complete tasks.

Tools: bash, readFile, writeFile, editFile, listFiles, grep
Call functions directly when you need to make changes. Do not describe what you will do - do it.`;

    case "mistral":
    case "groq":
    case "xai":
    case "openrouter":
      return `You are a coding agent. Use tools to make changes directly.

Tools: bash, readFile, writeFile, editFile, listFiles, grep
Do not ask for permission. Make changes immediately using the appropriate tool.`;

    default:
      return `You are a coding agent. Use available tools to complete tasks. Make changes directly.`;
  }
}
