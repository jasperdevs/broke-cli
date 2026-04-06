import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { z } from "zod";
import { tool } from "ai";
import { assessCommand } from "../core/safety.js";

/** Max chars sent back to LLM context (~2000 tokens) */
const MAX_OUTPUT_CHARS = 8000;
/** Max chars kept in memory for UI display */
const MAX_UI_CHARS = 100_000;

/** Callback for streaming bash output chunks to the UI */
export type BashOutputCallback = (chunk: string) => void;

/** Global callback — set by the app to receive streaming bash output */
let onBashOutput: BashOutputCallback | null = null;

export function setBashOutputCallback(cb: BashOutputCallback | null): void {
  onBashOutput = cb;
}

/** Truncate output keeping head + tail for maximum usefulness */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const lines = output.split("\n");
  if (lines.length <= 60) return output.slice(0, MAX_OUTPUT_CHARS) + "\n[truncated]";
  const headLines = lines.slice(0, 40);
  const tailLines = lines.slice(-20);
  const omitted = lines.length - 60;
  return headLines.join("\n") + `\n\n[... ${omitted} lines omitted ...]\n\n` + tailLines.join("\n");
}

export const bashTool = tool({
  description: "Run a shell command and return stdout/stderr. Use for: builds, tests, git, installs, system commands. Do NOT use for file reads (use readFile), file writes (use writeFile), or search (use grep). Commands run in the project's working directory.",
  inputSchema: z.object({
    command: z.string().describe("Shell command to execute"),
    timeout: z.number().optional().describe("Timeout in ms (default 30000)"),
  }),
  execute: async ({ command, timeout }, options) => {
    const risk = assessCommand(command);
    if (risk.level === "dangerous") {
      return { success: false as const, output: "", error: risk.reason ?? "Command blocked for safety" };
    }

    const timeoutMs = timeout ?? 30000;

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      // Use shell to support pipes, redirects, etc.
      const isWin = process.platform === "win32";
      const proc = spawn(isWin ? "cmd" : "bash", isWin ? ["/c", command] : ["-c", command], {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      // Stream stdout chunks to UI in real-time
      proc.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString("utf-8");
        stdout += chunk;
        onBashOutput?.(chunk);
        // Hard limit to prevent memory issues
        if (stdout.length > 1024 * 1024) {
          killed = true;
          proc.kill("SIGTERM");
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString("utf-8");
        stderr += chunk;
        onBashOutput?.(chunk);
      });

      // Timeout
      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
        // Force kill after 2s if SIGTERM doesn't work
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
        }, 2000);
      }, timeoutMs);

      // Abort signal — cancel the running process when ESC is pressed
      const abortHandler = () => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
        }, 1000);
      };
      options?.abortSignal?.addEventListener("abort", abortHandler, { once: true });

      proc.on("close", (code) => {
        clearTimeout(timer);
        options?.abortSignal?.removeEventListener("abort", abortHandler);

        if (killed && !stdout && !stderr) {
          resolve({ success: false as const, output: "", error: "Command cancelled" });
          return;
        }

        // Save large output to temp file
        let tempPath: string | undefined;
        if (stdout.length > MAX_UI_CHARS) {
          try {
            tempPath = join(tmpdir(), `brokecli-bash-${Date.now()}.log`);
            writeFileSync(tempPath, stdout, "utf-8");
          } catch { /* ignore temp file errors */ }
        }

        const output = truncateOutput(stdout.trim());
        const note = tempPath ? `\n[Full output: ${tempPath}]` : "";

        if (code === 0 || code === null) {
          resolve({ success: true as const, output: output + note });
        } else {
          let error = stderr.trim() || `Exit code ${code}`;
          if (error.length > MAX_OUTPUT_CHARS) {
            error = error.slice(0, MAX_OUTPUT_CHARS) + "\n[truncated]";
          }
          resolve({
            success: false as const,
            output: output.slice(0, MAX_OUTPUT_CHARS),
            error,
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        options?.abortSignal?.removeEventListener("abort", abortHandler);
        resolve({ success: false as const, output: "", error: err.message });
      });
    });
  },
});
