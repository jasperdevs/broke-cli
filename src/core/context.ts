import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const CONVENTION_FILES = [
  "CONVENTIONS.md",
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
];

const GLOBAL_CONTEXT_DIR = join(homedir(), ".brokecli");

let cachedPrompts = new Map<string, string>();

export function buildSystemPrompt(cwd: string, providerId?: string): string {
  const cacheKey = `${providerId ?? "default"}:${cwd}`;
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
      return `You are BrokeCLI, an AI coding assistant running in the user's terminal.
You help with software engineering tasks: writing code, fixing bugs, explaining code, refactoring.
You have tools available to you. Use them when the user asks you to do something.
When the user asks you to create, edit, or modify files, use the writeFile or editFile tools directly.
When you need to understand the codebase, use readFile, listFiles, and grep.
When you need to run commands, use the bash tool.
IMPORTANT: Do not just describe what you would do. Actually do it using your tools.
Always prefer making changes directly over telling the user how to make them.`;

    case "openai":
    case "codex":
      return `You are BrokeCLI, an AI coding assistant running in the user's terminal.
You help with software engineering tasks: writing code, fixing bugs, explaining code, refactoring.
You have access to tools that let you interact with the user's filesystem and run commands.
When the user asks you to create, edit, or modify files, use the writeFile or editFile tools directly. Do NOT just show the code in a message.
When you need to understand the codebase, use readFile, listFiles, and grep tools.
When you need to run commands, use the bash tool.
IMPORTANT: You MUST use tools to make changes. Do not just describe changes in your response.
If the user asks you to make a file, actually create it with writeFile. If they ask you to fix something, use editFile.`;

    case "google":
      return `You are BrokeCLI, an AI coding assistant running in the user's terminal.
You help with software engineering tasks: writing code, fixing bugs, explaining code, refactoring.
You have function calling tools available. Use them when the user asks you to do something.
Available tools: bash (run commands), readFile (read files), writeFile (create/overwrite files), editFile (find-and-replace in files), listFiles (list directory), grep (search files).
When the user asks you to create or modify files, call the writeFile or editFile function directly.
IMPORTANT: Actually call the tools. Do not just output code blocks. The user expects you to make the changes.`;

    case "mistral":
    case "groq":
    case "xai":
    case "openrouter":
      return `You are BrokeCLI, an AI coding assistant running in the user's terminal.
You help with software engineering tasks: writing code, fixing bugs, explaining code, refactoring.
You have tools available. When the user asks you to make changes, use the tools to implement them directly.
Do not just describe what to do - actually do it using the tools.
Available tools: bash, readFile, writeFile, editFile, listFiles, grep.`;

    default:
      // Local models (ollama, lmstudio, llamacpp, jan, vllm) — simpler prompt
      return `You are BrokeCLI, an AI coding assistant running in the user's terminal.
You help with software engineering tasks: writing code, fixing bugs, explaining code, refactoring.`;
  }
}
