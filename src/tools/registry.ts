import type { ToolSet } from "ai";
import { createBashTool } from "./bash.js";
import { createReadFileTool, createWriteFileTool, createEditFileTool, createListFilesTool, createGrepTool, createSemSearchTool } from "./file-ops-tools.js";
import { webSearchTool, webFetchTool } from "./web.js";
import { todoWriteTool } from "./todo.js";
import { getExtensionTools } from "../core/extensions.js";
import { isToolAllowed } from "../core/permissions.js";

export const TOOL_NAMES = [
  "bash",
  "readFile",
  "writeFile",
  "editFile",
  "listFiles",
  "grep",
  "semSearch",
  "webSearch",
  "webFetch",
  "todoWrite",
] as const;

export type ToolName = typeof TOOL_NAMES[number] | string;

function createBaseTools(cwd = process.cwd()): ToolSet {
  return {
  bash: createBashTool(cwd),
  readFile: createReadFileTool(cwd),
  writeFile: createWriteFileTool(cwd),
  editFile: createEditFileTool(cwd),
  listFiles: createListFilesTool(cwd),
  grep: createGrepTool(cwd),
  semSearch: createSemSearchTool(cwd),
  webSearch: webSearchTool,
  webFetch: webFetchTool,
  todoWrite: todoWriteTool,
  };
}

/** All tools available to the agent */
export function getTools(options?: {
  include?: readonly string[];
  extraTools?: ToolSet;
  cwd?: string;
}): ToolSet {
  const include = options?.include ? new Set<string>(options.include) : null;
  const all: ToolSet = {
    ...createBaseTools(options?.cwd),
    ...getExtensionTools(),
    ...(options?.extraTools ?? {}),
  };

  return Object.fromEntries(
    Object.entries(all).filter(([name]) => (!include || include.has(name)) && isToolAllowed(name)),
  ) as ToolSet;
}
