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
You have access to these tools. Use them to complete tasks:

- bash: Execute shell commands. Use for tests, builds, git, package managers.
- readFile: Read file contents. Use to understand existing code.
- writeFile: CREATE files. Use to make new files.
- editFile: MODIFY existing files. Use find-and-replace.
- listFiles: List directory contents.
- grep: Search for patterns in files.

CRITICAL: When asked to create a file, use writeFile IMMEDIATELY.
Do NOT show code in your response. Do NOT explain what you will do.
Just call writeFile with the content.

Example user request: "make an index.html file"
Correct response: Call writeFile with path "index.html" and the HTML content.
WRONG: Showing the HTML code in a code block.
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
  const toolExamples = `

TOOL USAGE EXAMPLES:
- Create file: writeFile("index.html", "<html>...</html>")
- Edit file: editFile("src/app.ts", "old text", "new text")
- Read file: readFile("src/app.ts")
- Run command: bash("npm test")
- List files: listFiles("src")
- Search: grep("pattern", "src")`;

  switch (providerId) {
    case "anthropic":
      return `You are a coding agent. Execute tasks using tools.

NEVER show code in your response. Use writeFile/editFile instead.
When asked to create a file: call writeFile immediately.
When asked to edit: call editFile immediately.${toolExamples}`;

    case "openai":
    case "codex":
      return `You are a coding agent. Execute tasks using tools.

CRITICAL: When asked to create/edit files, call writeFile/editFile.
DO NOT output code blocks. USE THE TOOLS.
When asked to make a file, call writeFile(path, content).${toolExamples}`;

    case "google":
      return `You are a coding agent. Use function calls to execute tasks.

When asked to create a file: call writeFile function with path and content.
DO NOT output code. CALL THE FUNCTION.${toolExamples}`;

    case "mistral":
    case "groq":
    case "xai":
    case "openrouter":
      return `You are a coding agent. Execute tasks using tools.

Use writeFile to create files. Use editFile to modify files.
Do not ask permission. Do not show code. Use tools.${toolExamples}`;

    default:
      return `You are a coding agent. Use tools to complete tasks.

When asked to create files: use writeFile.
When asked to edit files: use editFile.${toolExamples}`;
  }
}
