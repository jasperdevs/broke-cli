import { spawn, type SpawnOptionsWithoutStdio } from "child_process";
import { existsSync } from "fs";
import { calculateCost, type TokenUsage } from "./cost.js";
import { createNativeEventHandlers } from "./native-stream-event-handlers.js";
import { getCodexOutputSchemaPath, parseStructuredFinalText } from "./native-output.js";
import { estimateConversationTokens, estimateTextTokens } from "./tokens.js";
import { resolveNativeCommand } from "./native-cli.js";
import { resolveThinkingConfig } from "./thinking.js";
import { getWorkspaceRoot, getAutonomySettings } from "../core/permissions.js";

interface NativeMessage {
  role: "user" | "assistant";
  content: string;
  images?: Array<{ mimeType: string; data: string }>;
}

interface NativeStreamCallbacks {
  onText: (delta: string) => void;
  onReasoning: (delta: string) => void;
  onFinish: (usage: TokenUsage) => void;
  onError: (error: Error) => void;
  onToolCallStart?: (toolName: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onAfterToolCall?: () => void;
  onAfterResponse?: () => void;
}

export interface NativeStreamOptions {
  providerId: "anthropic" | "codex";
  modelId: string;
  system: string;
  messages: NativeMessage[];
  abortSignal?: AbortSignal;
  enableThinking?: boolean;
  thinkingLevel?: string;
  cwd?: string;
  denyToolUse?: boolean;
  structuredFinalResponse?: { maxChars: number } | null;
}

function formatNativePrompt(system: string, messages: NativeMessage[]): string {
  const conversation = messages
    .map((message) => {
      const imageNote = message.images?.length
        ? `\n[${message.images.length} image attachment(s)]`
        : "";
      return `${message.role === "user" ? "USER" : "ASSISTANT"}\n${message.content}${imageNote}`;
    })
    .join("\n\n");

  return [
    "SYSTEM",
    system.trim(),
    "MESSAGES",
    conversation,
    "Reply to the latest USER message.",
  ].join("\n");
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractUsage(usage: unknown): { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } {
  const record = typeof usage === "object" && usage !== null ? usage as Record<string, unknown> : {};
  return {
    inputTokens: toNumber(record.input_tokens ?? record.inputTokens),
    outputTokens: toNumber(record.output_tokens ?? record.outputTokens),
    cacheReadTokens: toNumber(record.cache_read_input_tokens ?? record.cacheReadInputTokens ?? record.cached_input_tokens ?? record.cachedInputTokens),
    cacheWriteTokens: toNumber(record.cache_creation_input_tokens ?? record.cacheWriteInputTokens ?? record.cache_write_input_tokens ?? record.cacheWriteTokens),
  };
}

export function normalizeNativeUsage(options: {
  providerId: NativeStreamOptions["providerId"];
  reported: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}): { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } {
  const { providerId, reported, estimatedInputTokens, estimatedOutputTokens } = options;
  let inputTokens = reported.inputTokens > 0 ? reported.inputTokens : estimatedInputTokens;
  let outputTokens = reported.outputTokens > 0 ? reported.outputTokens : estimatedOutputTokens;
  let cacheReadTokens = reported.cacheReadTokens > 0 ? reported.cacheReadTokens : 0;
  let cacheWriteTokens = reported.cacheWriteTokens > 0 ? reported.cacheWriteTokens : 0;

  if (providerId === "codex") {
    // Native Codex can report hidden/orchestration input usage that is far above the
    // visible prompt we actually build. Keep session totals grounded in the prompt
    // layer instead of letting one trivial turn explode lifetime usage.
    const maxTrustedInput = Math.max(estimatedInputTokens * 3, estimatedInputTokens + 4096);
    if (inputTokens > maxTrustedInput) {
      inputTokens = estimatedInputTokens;
    }
  }

  if (outputTokens < 0) outputTokens = estimatedOutputTokens;
  if (inputTokens < 0) inputTokens = estimatedInputTokens;
  if (cacheReadTokens < 0) cacheReadTokens = 0;
  if (cacheWriteTokens < 0) cacheWriteTokens = 0;

  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function buildClaudeArgs(opts: NativeStreamOptions): string[] {
  const workspaceRoot = getWorkspaceRoot(opts.cwd ?? process.cwd());
  const autonomy = getAutonomySettings();
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--model",
    opts.modelId,
    "--system-prompt",
    opts.system,
    "--permission-mode",
    opts.denyToolUse ? "plan" : "acceptEdits",
    "--add-dir",
    workspaceRoot,
  ];

  for (const root of autonomy.additionalReadRoots) {
    args.push("--add-dir", root);
  }
  for (const root of autonomy.additionalWriteRoots) {
    args.push("--add-dir", root);
  }

  const thinking = resolveThinkingConfig({
    providerId: opts.providerId,
    modelId: opts.modelId,
    enabled: opts.enableThinking,
    level: opts.thinkingLevel,
  });
  if (thinking.enabled) {
    args.push("--effort", thinking.effort ?? "low");
  }

  return args;
}

export function isIsolatedLinuxContainerRuntime(): boolean {
  if (process.platform !== "linux") return false;
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

export function resolveCodexSandboxMode(opts: Pick<NativeStreamOptions, "denyToolUse">): "read-only" | "workspace-write" | "danger-full-access" {
  if (opts.denyToolUse) return "read-only";

  const autonomy = getAutonomySettings();

  // Native Codex relies on nested sandboxing for workspace-write mode. In
  // already-isolated Linux containers that often fails with bubblewrap/userns
  // errors, so prefer the outer container boundary instead of breaking tool use.
  if (
    isIsolatedLinuxContainerRuntime()
    && !autonomy.allowWriteOutsideWorkspace
    && !autonomy.allowShellOutsideWorkspace
  ) {
    return "danger-full-access";
  }

  return "workspace-write";
}

function buildCodexArgs(opts: NativeStreamOptions): string[] {
  const workspaceRoot = getWorkspaceRoot(opts.cwd ?? process.cwd());
  const autonomy = getAutonomySettings();
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-m",
    opts.modelId,
    "-C",
    opts.cwd ?? process.cwd(),
    "--sandbox",
    resolveCodexSandboxMode(opts),
    "--add-dir",
    workspaceRoot,
  ];

  for (const root of autonomy.additionalWriteRoots) {
    args.push("--add-dir", root);
  }

  if (opts.structuredFinalResponse?.maxChars) {
    args.push("--output-schema", getCodexOutputSchemaPath(opts.structuredFinalResponse.maxChars));
  }

  return args;
}

function needsWindowsShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

export function resolveNativeSpawnCommand(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (!needsWindowsShell(command)) {
    return { command, args };
  }
  const comspec = process.env.ComSpec || "cmd.exe";
  return {
    command: comspec,
    args: ["/d", "/s", "/c", command, ...args],
  };
}

function spawnNativeProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) {
  const resolved = resolveNativeSpawnCommand(command, args);
  return spawn(resolved.command, resolved.args, {
    ...options,
  });
}

function extractNativeErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const message = typeof parsed.message === "string"
        ? parsed.message
        : typeof (parsed.error as Record<string, unknown> | undefined)?.message === "string"
          ? ((parsed.error as Record<string, unknown>).message as string)
          : "";
      if (message) return message;
    } catch {
      continue;
    }
  }
  return trimmed;
}

export async function startNativeStream(
  opts: NativeStreamOptions,
  callbacks: NativeStreamCallbacks,
): Promise<void> {
  const prompt = formatNativePrompt(opts.system, opts.messages);
  const estimatedInputTokens = estimateConversationTokens(opts.system, opts.messages, opts.modelId);
  const commandName = opts.providerId === "anthropic" ? "claude" : "codex";
  const command = resolveNativeCommand(commandName) ?? commandName;
  const args = opts.providerId === "anthropic" ? buildClaudeArgs(opts) : buildCodexArgs(opts);

  await new Promise<void>((resolve) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let finished = false;
    let aborted = false;
    let lineHadParseError = false;

    const child = spawnNativeProcess(command, args, {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const finishWithUsage = (usageData?: unknown) => {
      if (finished) return;
      finished = true;
      const usage = normalizeNativeUsage({
        providerId: opts.providerId,
        reported: extractUsage(usageData),
        estimatedInputTokens,
        estimatedOutputTokens: estimateTextTokens(handlers.getCombinedOutputText(), opts.modelId),
      });
      callbacks.onAfterResponse?.();
      callbacks.onFinish(calculateCost(
        opts.modelId,
        usage.inputTokens,
        usage.outputTokens,
        opts.providerId,
        {
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
        },
      ));
      resolve();
    };

    const fail = (message: string) => {
      if (finished || aborted) return;
      finished = true;
      callbacks.onError(new Error(message));
      resolve();
    };
    const handlers = createNativeEventHandlers({
      providerId: opts.providerId,
      denyToolUse: opts.denyToolUse,
      structuredFinalResponse: opts.structuredFinalResponse,
      callbacks,
      fail,
      finishWithUsage,
      parseStructuredFinalText,
    });

    const handleJsonLine = (line: string) => {
      if (!line.trim()) return;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        lineHadParseError = true;
        return;
      }

      handlers.handleJsonEvent(event);
    };

    const flushStdout = () => {
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        handleJsonLine(line);
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    };

    if (opts.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => {
        aborted = true;
        child.kill();
        resolve();
      }, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      flushStdout();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
    });

    child.on("error", (error) => {
      fail(error.message);
    });

    child.on("close", (code) => {
      if (aborted || finished) return;
      if (stdoutBuffer.trim()) {
        handleJsonLine(stdoutBuffer.trim());
        stdoutBuffer = "";
      }
      if (finished) return;

      const fallbackUsage = calculateCost(
        opts.modelId,
        estimatedInputTokens,
        estimateTextTokens(handlers.getCombinedOutputText(), opts.modelId),
        opts.providerId,
      );

      if (code === 0 && handlers.getCombinedOutputText()) {
        callbacks.onAfterResponse?.();
        callbacks.onFinish(fallbackUsage);
        resolve();
        return;
      }

      const details = extractNativeErrorMessage(stderrBuffer)
        || (lineHadParseError ? "Native CLI emitted non-JSON output." : "")
        || `${commandName} exited with code ${code ?? "unknown"}`;
      fail(details);
    });

    child.stdin.end(prompt);
  });
}
