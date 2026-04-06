import { z } from "zod";
import { tool } from "ai";
import { buildRepoMap, formatRepoMap } from "../core/repo-map.js";

export const repoMapTool = tool({
  description: "Build a compact repository map with important files and symbol lines. Use this first when exploring unfamiliar code or when you need a high-level view before reading files in detail.",
  inputSchema: z.object({
    query: z.string().optional().describe("Optional focus terms to bias the map toward relevant files"),
    maxFiles: z.number().optional().describe("Max files to include (default 40)"),
    maxLinesPerFile: z.number().optional().describe("Max lines per file (default 8)"),
  }),
  execute: async ({ query, maxFiles, maxLinesPerFile }) => {
    const entries = buildRepoMap({ query, maxFiles, maxLinesPerFile });
    return {
      success: true as const,
      entries,
      text: formatRepoMap(entries),
    };
  },
});
