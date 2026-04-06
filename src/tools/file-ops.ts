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

export const readFileTool = tool({
  description: "Read file contents. Always read before editing. Use offset/limit for files over 500 lines. Output is truncated at ~2000 tokens.",
  inputSchema: z.object({
    path: z.string().describe("File path (relative or absolute)"),
    offset: z.number().optional().describe("Start line (0-based)"),
    limit: z.number().optional().describe("Max lines to return"),
  }),
  execute: async ({ path, offset, limit }) => {
    try {
      const raw = readFileSync(path, "utf-8");
      let content = raw;

      // Apply line offset/limit if specified
      if (offset !== undefined || limit !== undefined) {
        const lines = raw.split("\n");
        const start = offset ?? 0;
        const end = limit ? start + limit : lines.length;
        content = lines.slice(start, end).join("\n");
      }

      // Truncate to save context tokens
      const totalLines = raw.split("\n").length;
      if (content.length > MAX_READ_CHARS) {
        content = content.slice(0, MAX_READ_CHARS);
        return {
          success: true as const,
          content,
          totalLines,
          truncated: true,
          note: `File truncated at ~2000 tokens. Use offset/limit to read specific sections.`,
        };
      }
      return { success: true as const, content, totalLines };
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
  description: "Search file contents with regex. Use to find function definitions, imports, usages, or any text pattern across the codebase. Returns matching lines with file paths and line numbers. Max 30 matches.",
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
    return { matches, totalMatches: matches.length, capped: matches.length >= MAX_GREP_MATCHES };
  },
});
