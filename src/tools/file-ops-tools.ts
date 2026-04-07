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

export const readFileTool = tool({
  description: "Read file contents. Use mode=full for exact edits, mode=minimal to drop obvious noise, or mode=aggressive for structure-first exploration on large files. Use offset/limit for files over 500 lines.",
  inputSchema: z.object({
    path: z.string().describe("File path (relative or absolute)"),
    offset: z.number().optional().describe("Start line (0-based)"),
    limit: z.number().optional().describe("Max lines to return"),
    mode: z.enum(["full", "minimal", "aggressive"]).optional().describe("Read mode (default: full)"),
    tail: z.number().optional().describe("Return only the last N lines"),
  }),
  execute: async ({ path, offset, limit, mode, tail }) => readFileMaybeRemote({ path, offset, limit, mode, tail }),
});

export const writeFileTool = tool({
  description: "Create a new file or completely overwrite an existing one. For targeted changes to existing files, use editFile instead. Always readFile first if the file already exists.",
  inputSchema: z.object({
    path: z.string().describe("File path to write"),
    content: z.string().describe("Complete file content"),
  }),
  execute: async ({ path, content }) => writeFileDirect({ path, content }),
});

export const editFileTool = tool({
  description: "Replace an exact string in a file with new content. The old_string must match EXACTLY (including whitespace/indentation). Include enough surrounding lines to make old_string unique. Preferred over writeFile for changes to existing files.",
  inputSchema: z.object({
    path: z.string().describe("File path to edit"),
    old_string: z.string().describe("Exact existing text to find (must be unique in the file)"),
    new_string: z.string().describe("Replacement text"),
  }),
  execute: async ({ path, old_string, new_string }) => editFileDirect({ path, old_string, new_string }),
});

export const listFilesTool = tool({
  description: "List files and directories recursively. Use as a first step when exploring unfamiliar code. Skips hidden files and node_modules. Returns a compact list capped at 120 entries plus total count.",
  inputSchema: z.object({
    path: z.string().describe("Directory to list (default: current dir)").default("."),
    maxDepth: z.number().optional().describe("Max recursion depth (default 3)"),
    include: z.string().optional().describe("Glob filter (e.g. '*.ts', 'src/*.tsx')"),
  }),
  execute: async ({ path, maxDepth, include }) => listFilesMaybeRemote({ path, maxDepth, include }),
});

export const grepTool = tool({
  description: "Search file contents with regex. Returns grouped results by file with compact example lines, plus capped raw matches for exact follow-up. Use this before broad shell grep where possible.",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern (case-insensitive)"),
    path: z.string().describe("Directory to search (default: current dir)").default("."),
    include: z.string().optional().describe("File extension filter (e.g. '*.ts', '*.py')"),
  }),
  execute: async ({ pattern, path, include }) => grepDirect({ pattern, path, include }),
});

export const semSearchTool = tool({
  description: "Semantic-ish code discovery for natural-language queries. Use this before broad shell search when you know behavior or intent but not exact filenames or symbols.",
  inputSchema: z.object({
    query: z.string().describe("Natural-language description of the code or behavior to find"),
    path: z.string().describe("Directory to search (default: current dir)").default("."),
    include: z.string().optional().describe("Optional glob filter (e.g. '*.ts', 'src/*.rs')"),
    limit: z.number().optional().describe("Max results (default 6, max 8)"),
  }),
  execute: async ({ query, path, include, limit }) => semSearchDirect({ query, path, include, limit }),
});
