import type { ToolSet } from "ai";
import { bashTool } from "./bash.js";
import { readFileTool, writeFileTool, editFileTool, listFilesTool, grepTool, semSearchTool } from "./file-ops.js";
import { webSearchTool, webFetchTool } from "./web.js";
import { todoWriteTool } from "./todo.js";
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
  "agent",
] as const;

export type ToolName = typeof TOOL_NAMES[number];

const BASE_TOOLS: ToolSet = {
  bash: bashTool,
  readFile: readFileTool,
  writeFile: writeFileTool,
  editFile: editFileTool,
  listFiles: listFilesTool,
  grep: grepTool,
  semSearch: semSearchTool,
  webSearch: webSearchTool,
  webFetch: webFetchTool,
  todoWrite: todoWriteTool,
};

/** All tools available to the agent */
export function getTools(options?: {
  include?: readonly ToolName[];
  extraTools?: ToolSet;
}): ToolSet {
  const include = options?.include ? new Set<string>(options.include) : null;
  const all: ToolSet = {
    ...BASE_TOOLS,
    ...(options?.extraTools ?? {}),
  };

  return Object.fromEntries(
    Object.entries(all).filter(([name]) => (!include || include.has(name)) && isToolAllowed(name)),
  ) as ToolSet;
}
