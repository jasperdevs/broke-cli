import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { z } from "zod";
import { tool } from "ai";
import { assessFileWrite } from "../core/safety.js";
import { createCheckpoint } from "../core/git.js";

/** Max chars to return from file reads (~2000 tokens) */
const MAX_READ_CHARS = 8000;
/** Max lines from grep matches */
const MAX_GREP_MATCHES = 30;

function stripNoiseLines(content: string, path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if ((ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx" || ext === "rs" || ext === "java" || ext === "go") && (trimmed.startsWith("//") || trimmed === "{" || trimmed === "}")) return false;
      if (ext === "py" && trimmed.startsWith("#")) return false;
      return true;
    })
    .join("\n");
}

function aggressiveCodeSummary(content: string, path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const patterns = [
    /^\s*(export\s+)?(async\s+)?function\b/,
    /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/,
    /^\s*(export\s+)?class\b/,
    /^\s*(export\s+)?interface\b/,
    /^\s*(export\s+)?type\b/,
    /^\s*def\b/,
    /^\s*class\b/,
    /^\s*fn\b/,
    /^\s*impl\b/,
    /^\s*import\b/,
    /^\s*from\b/,
    /^\s*use\b/,
  ];

  const lines = content.split("\n");
  const kept = lines.filter((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (index < 20) return true;
    return patterns.some((pattern) => pattern.test(line));
  });

  const summarized = kept.join("\n");
  if (summarized.trim()) return summarized;
  return stripNoiseLines(content, path);
}

function applyReadMode(content: string, path: string, mode: "full" | "minimal" | "aggressive"): string {
  if (mode === "minimal") return stripNoiseLines(content, path);
  if (mode === "aggressive") return aggressiveCodeSummary(content, path);
  return content;
}

export const readFileTool = tool({
  description: "Read file contents. Use mode=full for exact edits, mode=minimal to drop obvious noise, or mode=aggressive for structure-first exploration on large files. Use offset/limit for files over 500 lines.",
  inputSchema: z.object({
    path: z.string().describe("File path (relative or absolute)"),
    offset: z.number().optional().describe("Start line (0-based)"),
    limit: z.number().optional().describe("Max lines to return"),
    mode: z.enum(["full", "minimal", "aggressive"]).optional().describe("Read mode (default: full)"),
  }),
  execute: async ({ path, offset, limit, mode }) => {
    try {
      const raw = readFileSync(path, "utf-8");
      let content = raw;
      const readMode = mode ?? "full";

      // Apply line offset/limit if specified
      if (offset !== undefined || limit !== undefined) {
        const lines = raw.split("\n");
        const start = offset ?? 0;
        const end = limit ? start + limit : lines.length;
        content = lines.slice(start, end).join("\n");
      }

      content = applyReadMode(content, path, readMode);

      // Truncate to save context tokens
      const totalLines = raw.split("\n").length;
      if (content.length > MAX_READ_CHARS) {
        content = content.slice(0, MAX_READ_CHARS);
        return {
          success: true as const,
          content,
          totalLines,
          truncated: true,
          note: `File truncated in ${readMode} mode. Use offset/limit to read specific sections.`,
        };
      }
      return { success: true as const, content, totalLines, mode: readMode };
    } catch (err: unknown) {
      return { success: false as const, error: (err as Error).message };
    }
  },
});

export const writeFileTool = tool({
  description: "Create a new file or completely overwrite an existing one. For targeted changes to existing files, use editFile instead. Always readFile first if the file already exists.",
  inputSchema: z.object({
    path: z.string().describe("File path to write"),
    content: z.string().describe("Complete file content"),
  }),
  execute: async ({ path, content }) => {
    const risk = assessFileWrite(path);
    if (risk.level === "warn") {
      return { success: false as const, error: `Blocked: ${risk.reason}` };
    }
    createCheckpoint();
    try {
      writeFileSync(path, content, "utf-8");
      return { success: true as const, bytesWritten: content.length };
    } catch (err: unknown) {
      return { success: false as const, error: (err as Error).message };
    }
  },
});

export const editFileTool = tool({
  description: "Replace an exact string in a file with new content. The old_string must match EXACTLY (including whitespace/indentation). Include enough surrounding lines to make old_string unique. Preferred over writeFile for changes to existing files.",
  inputSchema: z.object({
    path: z.string().describe("File path to edit"),
    old_string: z.string().describe("Exact existing text to find (must be unique in the file)"),
    new_string: z.string().describe("Replacement text"),
  }),
  execute: async ({ path, old_string, new_string }) => {
    createCheckpoint();
    try {
      const content = readFileSync(path, "utf-8");
      if (!content.includes(old_string)) {
        return { success: false as const, error: "old_string not found in file" };
      }
      const updated = content.replace(old_string, new_string);
      writeFileSync(path, updated, "utf-8");
      return { success: true as const };
    } catch (err: unknown) {
      return { success: false as const, error: (err as Error).message };
    }
  },
});

export const listFilesTool = tool({
  description: "List files and directories recursively. Use as a first step when exploring unfamiliar code. Skips hidden files and node_modules. Returns up to 200 entries.",
  inputSchema: z.object({
    path: z.string().describe("Directory to list (default: current dir)").default("."),
    maxDepth: z.number().optional().describe("Max recursion depth (default 3)"),
  }),
  execute: async ({ path: dir, maxDepth }) => {
    const max = maxDepth ?? 3;
    const files: string[] = [];

    function walk(d: string, depth: number) {
      if (depth > max) return;
      try {
        for (const entry of readdirSync(d)) {
          if (entry.startsWith(".") || entry === "node_modules") continue;
          const full = join(d, entry);
          const stat = statSync(full);
          const rel = relative(process.cwd(), full);
          if (stat.isDirectory()) {
            files.push(rel + "/");
            walk(full, depth + 1);
          } else {
            files.push(rel);
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    walk(dir, 0);
    return { files: files.slice(0, 200) };
  },
});

export const grepTool = tool({
  description: "Search file contents with regex. Returns grouped results by file with example lines, plus raw matches for exact follow-up. Use this before broad shell grep where possible.",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern (case-insensitive)"),
    path: z.string().describe("Directory to search (default: current dir)").default("."),
    include: z.string().optional().describe("File extension filter (e.g. '*.ts', '*.py')"),
  }),
  execute: async ({ pattern, path: dir, include }) => {
    const regex = new RegExp(pattern, "i");
    const matches: Array<{ file: string; line: number; text: string }> = [];

    function search(d: string) {
      try {
        for (const entry of readdirSync(d)) {
          if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
          const full = join(d, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            search(full);
          } else if (!include || full.endsWith(include.replace("*", ""))) {
            try {
              const content = readFileSync(full, "utf-8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  matches.push({
                    file: relative(process.cwd(), full),
                    line: i + 1,
                    text: lines[i].trim().slice(0, 150),
                  });
                  if (matches.length >= MAX_GREP_MATCHES) return;
                }
              }
            } catch { /* skip binary files */ }
          }
        }
      } catch { /* skip unreadable */ }
    }

    search(dir);
    const grouped = matches.reduce<Record<string, Array<{ line: number; text: string }>>>((acc, match) => {
      if (!acc[match.file]) acc[match.file] = [];
      acc[match.file].push({ line: match.line, text: match.text });
      return acc;
    }, {});
    const summary = Object.entries(grouped).map(([file, fileMatches]) => ({
      file,
      count: fileMatches.length,
      examples: fileMatches.slice(0, 3),
    }));
    return { matches, summary, totalMatches: matches.length, capped: matches.length >= MAX_GREP_MATCHES };
  },
});
