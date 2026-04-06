import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { z } from "zod";
import { tool } from "ai";
import { assessFileWrite } from "../core/safety.js";
import { createCheckpoint } from "../core/git.js";

export const readFileTool = tool({
  description: "Read the contents of a file",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to read"),
  }),
  execute: async ({ path }) => {
    try {
      const content = readFileSync(path, "utf-8");
      return { success: true as const, content };
    } catch (err: unknown) {
      return { success: false as const, error: (err as Error).message };
    }
  },
});

export const writeFileTool = tool({
  description: "Write content to a file, creating it if it doesn't exist",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to write"),
    content: z.string().describe("Content to write"),
  }),
  execute: async ({ path, content }) => {
    const risk = assessFileWrite(path);
    if (risk.level === "warn") {
      return { success: false as const, error: `Blocked: ${risk.reason}` };
    }
    createCheckpoint();
    try {
      writeFileSync(path, content, "utf-8");
      return { success: true as const };
    } catch (err: unknown) {
      return { success: false as const, error: (err as Error).message };
    }
  },
});

export const editFileTool = tool({
  description: "Replace a specific string in a file with new content",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to edit"),
    old_string: z.string().describe("The exact string to find and replace"),
    new_string: z.string().describe("The replacement string"),
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
  description: "List files in a directory, optionally with a glob pattern",
  inputSchema: z.object({
    path: z.string().describe("Directory path to list").default("."),
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
  description: "Search for a pattern in files under a directory",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().describe("Directory to search in").default("."),
    include: z.string().optional().describe("File glob to include (e.g. '*.ts')"),
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
                    text: lines[i].trim().slice(0, 200),
                  });
                  if (matches.length >= 50) return;
                }
              }
            } catch { /* skip binary files */ }
          }
        }
      } catch { /* skip unreadable */ }
    }

    search(dir);
    return { matches };
  },
});
