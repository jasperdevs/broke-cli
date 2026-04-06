import type { ToolSet } from "ai";
import { bashTool } from "./bash.js";
import { readFileTool, writeFileTool, editFileTool, listFilesTool, grepTool } from "./file-ops.js";
import { webSearchTool, webFetchTool } from "./web.js";
import { todoWriteTool } from "./todo.js";

/** All tools available to the agent */
export function getTools(): ToolSet {
  return {
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
}
