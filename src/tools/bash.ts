import { execSync } from "child_process";
import { z } from "zod";
import { tool } from "ai";
import { assessCommand } from "../core/safety.js";

/** Max chars from bash output (~1500 tokens). Prevents context bloat. */
const MAX_OUTPUT_CHARS = 6000;

export const bashTool = tool({
  description: "Execute a shell command and return its output",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default 30000)"),
  }),
  execute: async ({ command, timeout }) => {
    const risk = assessCommand(command);
    if (risk.level === "dangerous") {
      return { success: false as const, output: "", error: risk.reason ?? "Command blocked for safety" };
    }

    try {
      let output = execSync(command, {
        encoding: "utf-8",
        timeout: timeout ?? 30000,
        maxBuffer: 1024 * 1024,
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      // Truncate long output to save context tokens
      if (output.length > MAX_OUTPUT_CHARS) {
        const lines = output.split("\n");
        // Keep first and last lines for maximum usefulness
        const headLines = lines.slice(0, 40);
        const tailLines = lines.slice(-20);
        const omitted = lines.length - 60;
        output = headLines.join("\n") + `\n\n[... ${omitted} lines omitted ...]\n\n` + tailLines.join("\n");
      }

      return { success: true as const, output };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      let stderr = e.stderr?.trim() ?? e.message;
      if (stderr.length > MAX_OUTPUT_CHARS) {
        stderr = stderr.slice(0, MAX_OUTPUT_CHARS) + "\n[truncated]";
      }
      return {
        success: false as const,
        output: (e.stdout?.trim() ?? "").slice(0, MAX_OUTPUT_CHARS),
        error: stderr,
      };
    }
  },
});
