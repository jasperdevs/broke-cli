import type { ToolSet } from "ai";
import { bashTool } from "./bash.js";
import { readFileTool, writeFileTool, editFileTool, listFilesTool, grepTool } from "./file-ops.js";

/** All tools available to the agent */
export function getTools(): ToolSet {
  return {
    bash: bashTool,
    readFile: readFileTool,
    writeFile: writeFileTool,
    editFile: editFileTool,
    listFiles: listFilesTool,
    grep: grepTool,
  };
}
