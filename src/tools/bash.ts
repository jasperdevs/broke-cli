import { execSync } from "child_process";
import { z } from "zod";
import { tool } from "ai";
import { assessCommand } from "../core/safety.js";

export const bashTool = tool({
  description: "Execute a shell command and return its output. Use for running tests, installing packages, git operations, etc.",
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
      const output = execSync(command, {
        encoding: "utf-8",
        timeout: timeout ?? 30000,
        maxBuffer: 1024 * 1024,
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { success: true as const, output: output.trim() };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      return {
        success: false as const,
        output: e.stdout?.trim() ?? "",
        error: e.stderr?.trim() ?? e.message,
      };
    }
  },
});
