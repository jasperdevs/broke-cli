import { spawn, type SpawnOptionsWithoutStdio } from "child_process";
import { calculateCost, type TokenUsage } from "./cost.js";
import { estimateConversationTokens, estimateTextTokens } from "./tokens.js";
import { resolveNativeCommand } from "./native-cli.js";

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
  yoloMode?: boolean;
  cwd?: string;
}

function formatNativePrompt(system: string, messages: NativeMessage[]): string {
  const conversation = messages
    .map((message) => {
      const imageNote = message.images?.length
        ? `\n[${message.images.length} image(s) were attached to this turn in the original BrokeCLI session.]`
        : "";
      return `${message.role.toUpperCase()}:\n${message.content}${imageNote}`;
    })
    .join("\n\n");

  return [
    "System instructions:",
    system.trim(),
    "",
    "Conversation transcript:",
    conversation,
    "",
    "Respond as the assistant to the latest user message.",
  ].join("\n");
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractUsage(usage: unknown): { inputTokens: number; outputTokens: number } {
  const record = typeof usage === "object" && usage !== null ? usage as Record<string, unknown> : {};
  return {
    inputTokens: toNumber(record.input_tokens ?? record.inputTokens),
    outputTokens: toNumber(record.output_tokens ?? record.outputTokens),
  };
}

function extractClaudeText(message: unknown, blockType: "text" | "thinking"): string {
  const record = typeof message === "object" && message !== null ? message as Record<string, unknown> : {};
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .filter((block) => {
      const kind = typeof block === "object" && block !== null ? (block as Record<string, unknown>).type : undefined;
      return kind === blockType;
    })
    .map((block) => {
      const text = typeof block === "object" && block !== null ? (block as Record<string, unknown>).text : undefined;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function extractCodexItemText(item: unknown): string {
  const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.content)) {
    return record.content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).text === "string") {
          return (entry as Record<string, unknown>).text as string;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function emitDelta(next: string, previous: string, emit: (delta: string) => void): string {
  if (!next) return previous;
  if (next.startsWith(previous)) {
    const delta = next.slice(previous.length);
    if (delta) emit(delta);
  } else {
    emit(next);
  }
  return next;
}

function buildClaudeArgs(opts: NativeStreamOptions): string[] {
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
  ];

  if (opts.enableThinking) {
    const effortMap: Record<string, string> = {
      low: "low",
      medium: "medium",
      high: "high",
    };
    args.push("--effort", effortMap[opts.thinkingLevel ?? "low"] ?? "low");
  }

  if (opts.yoloMode) {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", "acceptEdits");
  }

  return args;
}

function buildCodexArgs(opts: NativeStreamOptions): string[] {
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-m",
    opts.modelId,
    "-C",
    opts.cwd ?? process.cwd(),
  ];

  if (opts.yoloMode) {
    args.push("--full-auto");
  } else {
    args.push("-s", "read-only");
  }

  return args;
}

function needsWindowsShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function quoteCmdArg(value: string): string {
  if (value.length === 0) return "\"\"";
  const escaped = value.replace(/(["^%!])/g, "^$1");
  return /[\s"&|<>^%!]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function resolveNativeSpawnCommand(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (!needsWindowsShell(command)) {
    return { command, args };
  }

  const comspec = process.env.ComSpec || "cmd.exe";
  const invocation = [`"${command}"`, ...args.map(quoteCmdArg)].join(" ");
  return { command: comspec, args: ["/d", "/s", "/c", invocation] };
}

function spawnNativeProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) {
  const resolved = resolveNativeSpawnCommand(command, args);
  return spawn(resolved.command, resolved.args, options);
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
    let emittedText = "";
    let emittedReasoning = "";
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
      const usage = extractUsage(usageData);
      callbacks.onAfterResponse?.();
      callbacks.onFinish(calculateCost(
        opts.modelId,
        usage.inputTokens > 0 ? usage.inputTokens : estimatedInputTokens,
        usage.outputTokens > 0 ? usage.outputTokens : estimateTextTokens(emittedText + emittedReasoning, opts.modelId),
        opts.providerId,
      ));
      resolve();
    };

    const fail = (message: string) => {
      if (finished || aborted) return;
      finished = true;
      callbacks.onError(new Error(message));
      resolve();
    };

    const handleCodexEvent = (event: Record<string, unknown>) => {
      const type = typeof event.type === "string" ? event.type : "";

      if (type === "item.completed") {
        const item = typeof event.item === "object" && event.item !== null ? event.item as Record<string, unknown> : {};
        const itemType = typeof item.type === "string" ? item.type : "";
        const text = extractCodexItemText(item);
        if ((itemType === "agent_message" || itemType === "message") && text) {
          emittedText = emitDelta(text, emittedText, callbacks.onText);
        }
        if (itemType.includes("reason") && text) {
          emittedReasoning = emitDelta(text, emittedReasoning, callbacks.onReasoning);
        }
        return;
      }

      if (type === "turn.completed") {
        finishWithUsage(event.usage);
        return;
      }

      if (type === "error") {
        const message = typeof event.message === "string" ? event.message : "Codex stream failed";
        fail(message);
      }
    };

    const handleClaudeEvent = (event: Record<string, unknown>) => {
      const type = typeof event.type === "string" ? event.type : "";

      if (type === "assistant") {
        const message = typeof event.message === "object" && event.message !== null ? event.message : null;
        const text = extractClaudeText(message, "text");
        const reasoning = extractClaudeText(message, "thinking");
        if (text) emittedText = emitDelta(text, emittedText, callbacks.onText);
        if (reasoning) emittedReasoning = emitDelta(reasoning, emittedReasoning, callbacks.onReasoning);
        return;
      }

      if (type === "result") {
        const isError = event.is_error === true;
        const resultText = typeof event.result === "string" ? event.result : "";
        if (isError) {
          fail(resultText || "Claude stream failed");
          return;
        }
        finishWithUsage(event.usage);
      }
    };

    const handleJsonLine = (line: string) => {
      if (!line.trim()) return;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        lineHadParseError = true;
        return;
      }

      if (opts.providerId === "anthropic") {
        handleClaudeEvent(event);
      } else {
        handleCodexEvent(event);
      }
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
        estimateTextTokens(emittedText + emittedReasoning, opts.modelId),
        opts.providerId,
      );

      if (code === 0 && (emittedText || emittedReasoning)) {
        callbacks.onAfterResponse?.();
        callbacks.onFinish(fallbackUsage);
        resolve();
        return;
      }

      const details = stderrBuffer.trim()
        || (lineHadParseError ? "Native CLI emitted non-JSON output." : "")
        || `${commandName} exited with code ${code ?? "unknown"}`;
      fail(details);
    });

    child.stdin.end(prompt);
  });
}
