import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { z } from "zod";
import { tool } from "ai";
import { assessCommand } from "../core/safety.js";
import { filterCommandOutput, rewriteCommand } from "./command-filter.js";
import { grepDirect, listFilesDirect, readFileDirect } from "./file-ops.js";

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

function unquote(arg: string): string {
  return arg.replace(/^['"]|['"]$/g, "");
}

function hasShellMetacharacters(command: string): boolean {
  return /[|><;&]/.test(command) || /\b(cd)\b/.test(command);
}

function renderGrepSummary(summary: Array<{ file: string; count: number; examples: Array<{ line: number; text: string }> }>): string {
  return summary
    .map((item) => [
      `${item.file} (${item.count})`,
      ...item.examples.map((example) => `  ${example.line}: ${example.text}`),
    ].join("\n"))
    .join("\n");
}

function rerouteSimpleShellCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed || hasShellMetacharacters(trimmed)) return null;

  const catMatch = trimmed.match(/^cat\s+(.+)$/i);
  if (catMatch) {
    const path = unquote(catMatch[1].trim());
    const result = readFileDirect({ path, mode: "full" });
    return result.success
      ? { ...result, output: result.content, rerouted: true as const, reroutedTo: "readFile" }
      : { ...result, output: "", rerouted: true as const, reroutedTo: "readFile" };
  }

  const headMatch = trimmed.match(/^head\s+-n\s+(\d+)\s+(.+)$/i);
  if (headMatch) {
    const [, count, rawPath] = headMatch;
    const result = readFileDirect({ path: unquote(rawPath.trim()), limit: Number(count), mode: "full" });
    return result.success
      ? { ...result, output: result.content, rerouted: true as const, reroutedTo: "readFile" }
      : { ...result, output: "", rerouted: true as const, reroutedTo: "readFile" };
  }

  const tailMatch = trimmed.match(/^tail\s+-n\s+(\d+)\s+(.+)$/i);
  if (tailMatch) {
    const [, count, rawPath] = tailMatch;
    const result = readFileDirect({ path: unquote(rawPath.trim()), tail: Number(count), mode: "full" });
    return result.success
      ? { ...result, output: result.content, rerouted: true as const, reroutedTo: "readFile" }
      : { ...result, output: "", rerouted: true as const, reroutedTo: "readFile" };
  }

  const findMatch = trimmed.match(/^find\s+(\S+)\s+-name\s+(.+)$/i);
  if (findMatch) {
    const [, rawDir, rawPattern] = findMatch;
    const result = listFilesDirect({
      path: unquote(rawDir.trim()),
      maxDepth: 12,
      include: unquote(rawPattern.trim()),
    });
    return {
      success: true as const,
      output: result.files.join("\n"),
      rerouted: true as const,
      reroutedTo: "listFiles",
      fileCount: result.files.length,
    };
  }

  const searchMatch = trimmed.match(/^(rg|grep)\s+(['"].+?['"]|\S+)(?:\s+(.+))?$/i);
  if (searchMatch) {
    const [, _cmd, rawPattern, rawRest] = searchMatch;
    let include: string | undefined;
    let path = ".";
    if (rawRest?.trim()) {
      const includeMatch = rawRest.match(/(?:-g|--glob)\s+(['"].+?['"]|\S+)/i);
      include = includeMatch ? unquote(includeMatch[1]) : undefined;
      const cleaned = rawRest
        .replace(/(?:-g|--glob)\s+(['"].+?['"]|\S+)/ig, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) path = unquote(cleaned);
    }
    const result = grepDirect({
      pattern: unquote(rawPattern),
      path,
      include,
    });
    return {
      success: true as const,
      output: renderGrepSummary(result.summary),
      rerouted: true as const,
      reroutedTo: "grep",
      matchCount: result.totalMatches,
    };
  }

  return null;
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

    const rerouted = rerouteSimpleShellCommand(command);
    if (rerouted) return rerouted;

    const timeoutMs = timeout ?? 30000;

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;
      const filteredCommand = rewriteCommand(command);

      // Use shell to support pipes, redirects, etc.
      const isWin = process.platform === "win32";
      const proc = spawn(isWin ? "cmd" : "bash", isWin ? ["/c", filteredCommand] : ["-c", filteredCommand], {
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

        const filtered = filterCommandOutput(command, stdout.trim(), stderr.trim(), code);
        const output = truncateOutput(filtered.output.trim());
        const note = !filtered.rawPath && tempPath ? `\n[Full output: ${tempPath}]` : "";

        if (code === 0 || code === null) {
          resolve({ success: true as const, output: output + note });
        } else {
          let error = filtered.error.trim() || `Exit code ${code}`;
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
