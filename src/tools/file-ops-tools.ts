import { tool } from "ai";
import { z } from "zod";
import {
  editFileDirect,
  grepDirect,
  listFilesMaybeRemote,
  readFileMaybeRemote,
  semSearchDirect,
  writeFileDirect,
} from "./file-ops.js";
import type { EditOperations, ListOperations, ReadOperations, SearchOperations, WriteOperations } from "./file-operations.js";

export function createReadFileTool(cwd = process.cwd(), options?: { operations?: ReadOperations }) {
  return tool({
    description: "Read file contents. Use mode=full for exact edits, mode=minimal to drop obvious noise, or mode=aggressive for structure-first exploration on large files. Use offset/limit for files over 500 lines.",
    inputSchema: z.object({
      path: z.string().describe("File path (relative or absolute)"),
      offset: z.number().optional().describe("Start line (0-based)"),
      limit: z.number().optional().describe("Max lines to return"),
      mode: z.enum(["full", "minimal", "aggressive"]).optional().describe("Read mode (default: full)"),
      tail: z.number().optional().describe("Return only the last N lines"),
      refresh: z.boolean().optional().describe("Force a fresh read instead of reusing a recent unchanged result"),
    }),
    execute: async ({ path, offset, limit, mode, tail, refresh }) => readFileMaybeRemote({ path, cwd, offset, limit, mode, tail, refresh, operations: options?.operations }),
  });
}

export function createWriteFileTool(cwd = process.cwd(), options?: { operations?: WriteOperations }) {
  return tool({
    description: "Create a new file or completely overwrite an existing one. Use this for genuinely new files or deliberate full rewrites. For existing files, prefer editFile/apply-patch style changes after reading the target first.",
    inputSchema: z.object({
      path: z.string().describe("File path to write"),
      content: z.string().describe("Complete file content"),
    }),
    execute: async ({ path, content }) => writeFileDirect({ path, cwd, content, operations: options?.operations }),
  });
}

export function createEditFileTool(cwd = process.cwd(), options?: { operations?: EditOperations }) {
  return tool({
    description: "Replace an exact string in a file with new content. The old_string must match EXACTLY (including whitespace/indentation). Include enough surrounding lines to make old_string unique. Preferred over writeFile for changes to existing files and the default patch-first editing path.",
    inputSchema: z.object({
      path: z.string().describe("File path to edit"),
      old_string: z.string().describe("Exact existing text to find (must be unique in the file)"),
      new_string: z.string().describe("Replacement text"),
    }),
    execute: async ({ path, old_string, new_string }) => editFileDirect({ path, cwd, old_string, new_string, operations: options?.operations }),
  });
}

export function createListFilesTool(cwd = process.cwd(), options?: { operations?: ListOperations }) {
  return tool({
    description: "List files and directories recursively. Use as a first step when exploring unfamiliar code. Skips hidden files and node_modules. Returns a compact list capped at 120 entries plus total count.",
    inputSchema: z.object({
      path: z.string().describe("Directory to list (default: current dir)").default("."),
      maxDepth: z.number().optional().describe("Max recursion depth (default 3)"),
      include: z.string().optional().describe("Glob filter (e.g. '*.ts', 'src/*.tsx')"),
    }),
    execute: async ({ path, maxDepth, include }) => listFilesMaybeRemote({ path, cwd, maxDepth, include, operations: options?.operations }),
  });
}

export function createGrepTool(cwd = process.cwd(), options?: { operations?: SearchOperations }) {
  return tool({
    description: "Search file contents with regex. Returns grouped results by file with compact example lines, plus capped raw matches for exact follow-up. Use this before broad shell grep where possible.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern (case-insensitive)"),
      path: z.string().describe("Directory to search (default: current dir)").default("."),
      include: z.string().optional().describe("File extension filter (e.g. '*.ts', '*.py')"),
    }),
    execute: async ({ pattern, path, include }) => grepDirect({ pattern, path, cwd, include, operations: options?.operations }),
  });
}

export function createSemSearchTool(cwd = process.cwd(), options?: { operations?: SearchOperations }) {
  return tool({
    description: "Semantic-ish code discovery for natural-language queries. Use this before broad shell search when you know behavior or intent but not exact filenames or symbols.",
    inputSchema: z.object({
      query: z.string().describe("Natural-language description of the code or behavior to find"),
      path: z.string().describe("Directory to search (default: current dir)").default("."),
      include: z.string().optional().describe("Optional glob filter (e.g. '*.ts', 'src/*.rs')"),
      limit: z.number().optional().describe("Max results (default 6, max 8)"),
    }),
    execute: async ({ query, path, include, limit }) => semSearchDirect({ query, path, cwd, include, limit, operations: options?.operations }),
  });
}

export const readFileTool = createReadFileTool();
export const writeFileTool = createWriteFileTool();
export const editFileTool = createEditFileTool();
export const listFilesTool = createListFilesTool();
export const grepTool = createGrepTool();
export const semSearchTool = createSemSearchTool();
