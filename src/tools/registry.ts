import type { ToolSet } from "ai";
import { bashTool } from "./bash.js";
import { readFileTool, writeFileTool, editFileTool, listFilesTool, grepTool } from "./file-ops.js";
import { webSearchTool, webFetchTool } from "./web.js";
import { todoWriteTool } from "./todo.js";
import { repoMapTool } from "./repo-map.js";
import { isToolAllowed } from "../core/permissions.js";

export const TOOL_NAMES = [
  "repoMap",
  "bash",
  "readFile",
  "writeFile",
  "editFile",
  "listFiles",
  "grep",
  "webSearch",
  "webFetch",
  "todoWrite",
] as const;

/** All tools available to the agent */
export function getTools(): ToolSet {
  const all: ToolSet = {
    repoMap: repoMapTool,
    bash: bashTool,
    readFile: readFileTool,
    writeFile: writeFileTool,
    editFile: editFileTool,
    listFiles: listFilesTool,
    grep: grepTool,
    webSearch: webSearchTool,
    webFetch: webFetchTool,
    todoWrite: todoWriteTool,
  };

  return Object.fromEntries(
    Object.entries(all).filter(([name]) => isToolAllowed(name)),
  ) as ToolSet;
}
