import { execFileSync, spawn } from "child_process";
import { createWriteStream, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { z } from "zod";
import { tool } from "ai";
import { filterCommandOutput, rewriteCommand } from "./command-filter.js";
import { grepDirect, listFilesDirect, readFileDirect } from "./file-ops.js";
import { checkShellCommandAccess } from "../core/permissions.js";

type CwdProvider = string | (() => string);
export interface BashOperations {
  exec(command: string, cwd: string, options: { onData: (data: Buffer) => void; signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv }): Promise<{ exitCode: number | null }>;
}

export interface BashSpawnContext { command: string; cwd: string; env: NodeJS.ProcessEnv }
export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;
export interface BashToolOptions { operations?: BashOperations; commandPrefix?: string; spawnHook?: BashSpawnHook }

function resolveCwd(cwd: CwdProvider): string {
  return typeof cwd === "function" ? cwd() : cwd;
}

/** Max chars sent back to LLM context (~1500 tokens) */
const MAX_OUTPUT_CHARS = 6000;
const MAX_ROLLING_OUTPUT_CHARS = MAX_OUTPUT_CHARS * 2;

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

function killProcessTree(pid: number): void {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
}

export function createLocalBashOperations(): BashOperations {
  return {
    exec: (command, cwd, { onData, signal, timeout, env }) => new Promise((resolve, reject) => {
      if (!existsSync(cwd)) { reject(new Error(`Working directory does not exist: ${cwd}`)); return; }
      const isWin = process.platform === "win32";
      const child = spawn(isWin ? "cmd" : "bash", isWin ? ["/c", command] : ["-c", command], {
        cwd,
        detached: true,
        env: env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let timedOut = false;
      const timeoutHandle = timeout && timeout > 0 ? setTimeout(() => {
        timedOut = true;
        if (child.pid) killProcessTree(child.pid);
      }, timeout) : undefined;
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      const onAbort = () => { if (child.pid) killProcessTree(child.pid); };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        signal?.removeEventListener("abort", onAbort);
      };
      child.on("error", (err) => { cleanup(); reject(err); });
      child.on("close", (code) => {
        cleanup();
        if (signal?.aborted) reject(new Error("aborted"));
        else if (timedOut) reject(new Error(`timeout:${timeout}`));
        else resolve({ exitCode: code });
      });
    }),
  };
}

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
  const base = { command, cwd, env: { ...process.env } };
  return spawnHook ? spawnHook(base) : base;
}

function rerouteSimpleShellCommand(command: string, cwd: string) {
  const trimmed = command.trim();
  if (!trimmed || hasShellMetacharacters(trimmed)) return null;

  const catMatch = trimmed.match(/^cat\s+(.+)$/i);
  if (catMatch) {
    const path = unquote(catMatch[1].trim());
    const result = readFileDirect({ path, cwd, mode: "full" });
    return result.success
      ? { ...result, output: result.content, rerouted: true as const, reroutedTo: "readFile" }
      : { ...result, output: "", rerouted: true as const, reroutedTo: "readFile" };
  }

  const headMatch = trimmed.match(/^head\s+-n\s+(\d+)\s+(.+)$/i);
  if (headMatch) {
    const [, count, rawPath] = headMatch;
    const result = readFileDirect({ path: unquote(rawPath.trim()), cwd, limit: Number(count), mode: "full" });
    return result.success
      ? { ...result, output: result.content, rerouted: true as const, reroutedTo: "readFile" }
      : { ...result, output: "", rerouted: true as const, reroutedTo: "readFile" };
  }

  const tailMatch = trimmed.match(/^tail\s+-n\s+(\d+)\s+(.+)$/i);
  if (tailMatch) {
    const [, count, rawPath] = tailMatch;
    const result = readFileDirect({ path: unquote(rawPath.trim()), cwd, tail: Number(count), mode: "full" });
    return result.success
      ? { ...result, output: result.content, rerouted: true as const, reroutedTo: "readFile" }
      : { ...result, output: "", rerouted: true as const, reroutedTo: "readFile" };
  }

  const findMatch = trimmed.match(/^find\s+(\S+)\s+-name\s+(.+)$/i);
  if (findMatch) {
    const [, rawDir, rawPattern] = findMatch;
    const result = listFilesDirect({
      path: unquote(rawDir.trim()),
      cwd,
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
      cwd,
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

export function createBashTool(cwd: CwdProvider = process.cwd(), toolOptions?: BashToolOptions) {
  const ops = toolOptions?.operations ?? createLocalBashOperations();
  return tool({
    description: "Run a shell command and return stdout/stderr. Use for: builds, tests, git, installs, system commands. Do NOT use for file reads (use readFile), file writes (use writeFile), or search (use grep). Commands run in the project's working directory.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute"),
      timeout: z.number().optional().describe("Timeout in ms (default 30000)"),
    }),
    execute: async ({ command, timeout }, execOptions) => {
      const workingDirectory = resolveCwd(cwd);
      const rerouted = rerouteSimpleShellCommand(command, workingDirectory);
      if (rerouted) return rerouted;

      const permission = checkShellCommandAccess(command, workingDirectory);
      if (!permission.allowed) {
        return { success: false as const, output: "", error: permission.reason ?? "Shell command blocked by autonomy policy." };
      }

      const resolvedCommand = toolOptions?.commandPrefix ? `${toolOptions.commandPrefix}\n${command}` : command;
      const spawnContext = resolveSpawnContext(rewriteCommand(resolvedCommand), workingDirectory, toolOptions?.spawnHook);
      return new Promise((resolve) => {
        let tempPath: string | undefined;
        let tempStream: ReturnType<typeof createWriteStream> | undefined;
        let totalBytes = 0;
        const chunks: Buffer[] = [];
        let chunkBytes = 0;
        const ensureTempFile = () => {
          if (tempPath) return;
          tempPath = join(tmpdir(), `brokecli-bash-${Date.now()}.log`);
          tempStream = createWriteStream(tempPath);
          for (const chunk of chunks) tempStream.write(chunk);
        };
        const onData = (data: Buffer) => {
          totalBytes += data.length;
          if (totalBytes > MAX_OUTPUT_CHARS) ensureTempFile();
          tempStream?.write(data);
          chunks.push(data);
          chunkBytes += data.length;
          while (chunkBytes > MAX_ROLLING_OUTPUT_CHARS && chunks.length > 1) chunkBytes -= chunks.shift()!.length;
          onBashOutput?.(data.toString("utf-8"));
        };
        ops.exec(spawnContext.command, spawnContext.cwd, {
          onData,
          signal: execOptions?.abortSignal,
          timeout: timeout ?? 30000,
          env: spawnContext.env,
        }).then(({ exitCode }) => {
          tempStream?.end();
          const raw = Buffer.concat(chunks).toString("utf-8");
          const filtered = filterCommandOutput(command, raw.trim(), "", exitCode);
          const output = truncateOutput(filtered.output.trim());
          const note = !filtered.rawPath && tempPath ? `\n[Full output: ${tempPath}]` : "";
          if (exitCode === 0 || exitCode === null) resolve({ success: true as const, output: output + note });
          else resolve({ success: false as const, output: output.slice(0, MAX_OUTPUT_CHARS), error: filtered.error.trim() || `Exit code ${exitCode}` });
        }).catch((err: Error) => {
          tempStream?.end();
          const output = Buffer.concat(chunks).toString("utf-8");
          if (err.message === "aborted") resolve({ success: false as const, output, error: "Command cancelled" });
          else if (err.message.startsWith("timeout:")) resolve({ success: false as const, output, error: `Command timed out after ${err.message.split(":")[1]}ms` });
          else resolve({ success: false as const, output, error: err.message });
        });
      });
    },
  });
}

export const bashTool = createBashTool(() => process.cwd());
