import { renderPrefixedWrappedLines, toolArgumentSummary, toolDescription, wrapVisibleText } from "./tool-render.js";

export interface TodoRenderItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "done";
}

export interface PendingRenderMessage {
  text: string;
  delivery: "steering" | "followup";
}

export function renderPendingMessagesBlock(options: {
  pendingMessages: PendingRenderMessage[];
  maxWidth: number;
  dim: string;
  reset: string;
}): string[] {
  const { pendingMessages, maxWidth, dim, reset } = options;
  if (pendingMessages.length === 0) return [];

  const steeringItems = pendingMessages.filter((item) => item.delivery === "steering");
  const followUpItems = pendingMessages.filter((item) => item.delivery === "followup");
  const lines: string[] = [];

  if (steeringItems.length > 0) {
    lines.push(`  ${dim}• Messages to be submitted after next tool call${reset}`);
    lines.push(`  ${dim}  (press esc to interrupt and send immediately)${reset}`);
    for (const item of steeringItems.slice(-4)) {
      const preview = item.text.replace(/\s+/g, " ").trim();
      for (const wrappedLine of wrapVisibleText(preview, Math.max(8, maxWidth - 8))) {
        lines.push(`  ${dim}↳ ${wrappedLine}${reset}`);
      }
    }
  }

  if (followUpItems.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`  ${dim}• Queued follow-up messages${reset}`);
    for (const item of followUpItems.slice(-4)) {
      const preview = item.text.replace(/\s+/g, " ").trim();
      for (const wrappedLine of wrapVisibleText(preview, Math.max(8, maxWidth - 8))) {
        lines.push(`  ${dim}↳ ${wrappedLine}${reset}`);
      }
    }
    lines.push(`  ${dim}  alt + ↑ edit last queued message${reset}`);
  }

  return lines;
}

function ensureOverlayGap(lines: string[]): void {
  if (lines.length === 0) return;
  if (lines[lines.length - 1] !== "") lines.push("");
}

function formatElapsedLabel(tc: { startedAt?: number; completedAt?: number }): string | null {
  if (!tc.startedAt) return null;
  const end = tc.completedAt ?? Date.now();
  const elapsedMs = Math.max(0, end - tc.startedAt);
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function renderToolCallBlock(options: {
  index?: number;
  tc: {
    name: string;
    preview: string;
    args?: unknown;
    resultDetail?: string;
    result?: string;
    error?: boolean;
    expanded: boolean;
    streamOutput?: string;
    status: "starting" | "running" | "done" | "failed";
    startedAt?: number;
    completedAt?: number;
  };
  maxWidth: number;
  spinnerFrame: number;
  colors: {
    error: string;
    ok: string;
    accent2: string;
    muted: string;
    text: string;
    diffRemoveBg: string;
    diffAddBg: string;
  };
  reset: string;
}): string[] {
  const { tc, maxWidth, spinnerFrame, colors, reset, index } = options;
  const lines: string[] = [];
  const done = tc.status === "done" || tc.status === "failed";
  const running = tc.status === "starting" || tc.status === "running";
  const branch = "\u2514";
  const statusIcon = done
    ? (tc.status === "failed" ? `${colors.error}✖${reset}` : `${colors.ok}✔${reset}`)
    : `${colors.accent2}${["◐", "◓", "◑", "◒"][spinnerFrame % 4]}${reset}`;
  const statusLabel = tc.status;
  const elapsedLabel = formatElapsedLabel(tc);
  const statusSuffix = `${colors.muted}${statusLabel}${elapsedLabel ? ` · ${elapsedLabel}` : ""}${reset}`;
  const ordinal = typeof index === "number" ? `${colors.muted}${index + 1}.${reset} ` : "";
  lines.push(`  ${ordinal}${statusIcon} ${done ? colors.muted : colors.text}${toolDescription(tc)}${reset} ${statusSuffix}`);

  const a = tc.args as Record<string, string> | undefined;

  if (running && tc.preview === "..." && !tc.streamOutput) {
    lines.push(`${colors.muted}  ${branch} waiting for tool details...${reset}`);
  }

  const argSummary = toolArgumentSummary(tc);
  if (argSummary && (running || (!done && !tc.resultDetail))) {
    for (const wrappedLine of renderPrefixedWrappedLines(`  ${branch} `, argSummary, maxWidth)) {
      lines.push(`${colors.muted}${wrappedLine}${reset}`);
    }
  }

  if (tc.name === "bash" && running && tc.streamOutput) {
    const outLines = tc.streamOutput.split("\n").filter((line) => line.trim());
    const tail = outLines.slice(-5);
    for (const line of tail) {
      for (const wrappedLine of renderPrefixedWrappedLines(`  ${branch} `, line, maxWidth)) {
        lines.push(`${colors.muted}${wrappedLine}${reset}`);
      }
    }
    if (outLines.length > 5) lines.push(`${colors.muted}  ${branch} ... +${outLines.length - 5} lines${reset}`);
  }

  if (done) {
    if (tc.name === "editFile" && a?.old_string && a?.new_string) {
      const oldLines = a.old_string.split("\n");
      const newLines = a.new_string.split("\n");
      const diffW = maxWidth - 6;
      lines.push(`${colors.muted}  ${branch} ${tc.resultDetail || `+${newLines.length} -${oldLines.length} lines`}${reset}`);
      for (const line of oldLines.slice(0, 4)) {
        const text = `- ${line}`.slice(0, diffW - 2);
        const pad = Math.max(0, diffW - 2 - text.length);
        lines.push(`  ${colors.diffRemoveBg} ${text}${" ".repeat(pad)} ${reset}`);
      }
      if (oldLines.length > 4) lines.push(`${colors.muted}      ... +${oldLines.length - 4} more${reset}`);
      for (const line of newLines.slice(0, 4)) {
        const text = `+ ${line}`.slice(0, diffW - 2);
        const pad = Math.max(0, diffW - 2 - text.length);
        lines.push(`  ${colors.diffAddBg} ${text}${" ".repeat(pad)} ${reset}`);
      }
      if (newLines.length > 4) lines.push(`${colors.muted}      ... +${newLines.length - 4} more${reset}`);
    } else if (tc.name === "writeFile" && a?.content) {
      const newLines = a.content.split("\n");
      const diffW = maxWidth - 6;
      lines.push(`${colors.muted}  ${branch} ${tc.resultDetail || `${newLines.length} lines written`}${reset}`);
      for (const line of newLines.slice(0, 6)) {
        const text = `+ ${line}`.slice(0, diffW - 2);
        const pad = Math.max(0, diffW - 2 - text.length);
        lines.push(`  ${colors.diffAddBg} ${text}${" ".repeat(pad)} ${reset}`);
      }
      if (newLines.length > 6) lines.push(`${colors.muted}      ... +${newLines.length - 6} more${reset}`);
    } else if (tc.name === "bash" && tc.streamOutput) {
      const outLines = tc.streamOutput.split("\n").filter((line) => line.trim());
      if (tc.expanded) {
        const showLines = outLines.slice(-20);
        if (outLines.length > 20) lines.push(`${colors.muted}    ... ${outLines.length - 20} earlier lines${reset}`);
        for (const line of showLines) {
          for (const wrappedLine of renderPrefixedWrappedLines(`  ${branch} `, line, maxWidth)) {
            lines.push(`${colors.muted}${wrappedLine}${reset}`);
          }
        }
      } else {
        const tail = outLines.slice(-3);
        for (const line of tail) {
          for (const wrappedLine of renderPrefixedWrappedLines(`  ${branch} `, line, maxWidth)) {
            lines.push(`${colors.muted}${wrappedLine}${reset}`);
          }
        }
        if (outLines.length > 3) lines.push(`${colors.muted}  ${branch} ... +${outLines.length - 3} lines (ctrl+o to expand)${reset}`);
      }
    } else if (tc.name === "bash") {
      lines.push(`${colors.muted}  ${branch} (no output)${reset}`);
    } else if (tc.resultDetail) {
      for (const wrappedLine of renderPrefixedWrappedLines(`  ${branch} `, tc.resultDetail, maxWidth)) {
        lines.push(`${colors.muted}${wrappedLine}${reset}`);
      }
    } else if (argSummary) {
      for (const wrappedLine of renderPrefixedWrappedLines(`  ${branch} `, argSummary, maxWidth)) {
        lines.push(`${colors.muted}${wrappedLine}${reset}`);
      }
    } else if (!tc.error && elapsedLabel) {
      lines.push(`${colors.muted}  ${branch} completed in ${elapsedLabel}${reset}`);
    }
  }

  if (tc.error && tc.result) {
    for (const wrappedLine of renderPrefixedWrappedLines(`  ${branch} `, tc.result, maxWidth)) {
      lines.push(`${colors.error}${wrappedLine}${reset}`);
    }
  }
  return lines;
}

function renderActivityBlock(options: {
  currentActivityStep: { label: string; status: "running" | "done"; startedAt: number; completedAt?: number } | null;
  toolExecutions: Array<{
    name: string;
    preview: string;
    args?: unknown;
    resultDetail?: string;
    result?: string;
    error?: boolean;
    expanded: boolean;
    streamOutput?: string;
    status: "starting" | "running" | "done" | "failed";
    startedAt?: number;
    completedAt?: number;
  }>;
  maxWidth: number;
  spinnerFrame: number;
  colors: {
    accent: string;
    ok: string;
    warn: string;
    dim: string;
    text: string;
    bold: string;
    reset: string;
    error: string;
    accent2: string;
    diffRemoveBg: string;
    diffAddBg: string;
  };
}): string[] {
  const { currentActivityStep, toolExecutions, maxWidth, spinnerFrame, colors } = options;
  if (!currentActivityStep && toolExecutions.length === 0) return [];
  const lines: string[] = [];
  lines.push(`  ${colors.accent}${colors.bold}${toolExecutions.length > 0 ? "Actions" : "Activity"}${colors.reset}`);
  if (currentActivityStep && toolExecutions.length === 0) {
    const icon = currentActivityStep.status === "done"
      ? `${colors.ok}✔${colors.reset}`
      : `${colors.accent}${["◐", "◓", "◑", "◒"][spinnerFrame % 4]}${colors.reset}`;
    const elapsed = formatElapsedLabel(currentActivityStep);
    lines.push(`  ${icon} ${colors.text}${currentActivityStep.label}${colors.reset}${elapsed ? ` ${colors.dim}${elapsed}${colors.reset}` : ""}`);
  }
  for (const [index, tc] of toolExecutions.entries()) {
    lines.push(...renderToolCallBlock({
      index,
      tc,
      maxWidth,
      spinnerFrame,
      colors: {
        error: colors.error,
        ok: colors.ok,
        accent2: colors.accent2,
        muted: colors.dim,
        text: colors.text,
        diffRemoveBg: colors.diffRemoveBg,
        diffAddBg: colors.diffAddBg,
      },
      reset: colors.reset,
    }));
  }
  return lines;
}

export function renderMessageOverlays(options: {
  staticLines: string[];
  maxWidth: number;
  currentActivityStep: { label: string; status: "running" | "done"; startedAt: number; completedAt?: number } | null;
  toolExecutions: Array<{
    name: string;
    preview: string;
    args?: unknown;
    resultDetail?: string;
    result?: string;
    error?: boolean;
    expanded: boolean;
    streamOutput?: string;
    status: "starting" | "running" | "done" | "failed";
    startedAt?: number;
    completedAt?: number;
  }>;
  thinkingBuffer: string;
  thinkingRequested: boolean;
  streamingActivitySummary?: string;
  hideThinkingBlock?: boolean;
  isStreaming: boolean;
  todoItems: TodoRenderItem[];
  spinnerFrame: number;
  streamStartTime: number;
  streamTokens: number;
  thinkingStartTime: number;
  thinkingDuration: number;
  isCompacting: boolean;
  compactStartTime: number;
  compactTokens: number;
  pendingMessages: PendingRenderMessage[];
  fmtTokens: (value: number) => string;
  sparkleSpinner: (frame: number, color?: string) => string;
  shimmerText: (text: string, frame: number, color?: string) => string;
  colors: {
    accent: string;
    ok: string;
    warn: string;
    dim: string;
    text: string;
    bold: string;
    reset: string;
  };
}): string[] {
  const {
    staticLines,
    maxWidth,
    currentActivityStep,
    toolExecutions,
    thinkingBuffer,
    thinkingRequested,
    streamingActivitySummary,
    isStreaming,
    todoItems,
    spinnerFrame,
    streamStartTime,
    streamTokens,
    thinkingStartTime,
    thinkingDuration,
    isCompacting,
    compactStartTime,
    compactTokens,
    pendingMessages,
    fmtTokens,
    sparkleSpinner,
    shimmerText,
    colors,
  } = options;

  const lines = [...staticLines];

  const activityLines = renderActivityBlock({
    currentActivityStep,
    toolExecutions,
    maxWidth,
    spinnerFrame,
    colors: {
      accent: colors.accent,
      ok: colors.ok,
      warn: colors.warn,
      dim: colors.dim,
      text: colors.text,
      bold: colors.bold,
      reset: colors.reset,
      error: colors.warn,
      accent2: colors.accent,
      diffRemoveBg: "",
      diffAddBg: "",
    },
  });
  if (activityLines.length > 0) {
    ensureOverlayGap(lines);
    lines.push(...activityLines);
    lines.push("");
  }

  if (todoItems.length > 0) {
    ensureOverlayGap(lines);
    const done = todoItems.filter((item) => item.status === "done").length;
    const total = todoItems.length;
    const spinChars = ["\u25DC", "\u25DD", "\u25DE", "\u25DF"];
    const spin = spinChars[spinnerFrame % spinChars.length];
    const allDone = done === total;

    if (isStreaming) {
      const elapsed = Date.now() - streamStartTime;
      const secs = Math.floor(elapsed / 1000);
      const mins = Math.floor(secs / 60);
      const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
      const inProgress = todoItems.find((item) => item.status === "in_progress");
      const headerText = inProgress ? inProgress.text : (allDone ? "Done" : "Working...");
      lines.push(`  ${colors.accent}${spin}${colors.reset} ${colors.accent}${headerText}${colors.reset}  ${colors.dim}${timeStr} · ${done}/${total}${colors.reset}`);
    } else {
      lines.push(`  ${allDone ? colors.ok : colors.accent}✔${colors.reset} ${colors.dim}Tasks ${done}/${total}${colors.reset}`);
    }

    for (let i = 0; i < todoItems.length; i++) {
      const item = todoItems[i];
      const branch = i === todoItems.length - 1 ? "\u2514" : "\u251C";
      const icon = item.status === "done" ? `${colors.ok}\u25A0${colors.reset}`
        : item.status === "in_progress" ? `${colors.accent}${spin}${colors.reset}`
        : `${colors.dim}\u25A1${colors.reset}`;
      const textColor = item.status === "done" ? colors.dim : item.status === "in_progress" ? `${colors.text}${colors.bold}` : colors.dim;
      lines.push(`  ${colors.dim}${branch}${colors.reset} ${icon} ${textColor}${item.text.slice(0, maxWidth - 10)}${colors.reset}`);
    }
    lines.push("");
  }

  if (isCompacting) {
    ensureOverlayGap(lines);
    const elapsed = Date.now() - compactStartTime;
    const secs = Math.floor(elapsed / 1000);
    const mins = Math.floor(secs / 60);
    const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
    const tokenStr = compactTokens > 0 ? ` ↑ ${fmtTokens(compactTokens)} tokens` : "";
    lines.push(`  ${sparkleSpinner(spinnerFrame, colors.warn)} ${shimmerText("Compacting conversation...", spinnerFrame, colors.warn)} ${colors.dim}(${timeStr}${tokenStr ? ` ·${tokenStr}` : ""})${colors.reset}`);
    lines.push("");
  }

  if (isStreaming) {
    ensureOverlayGap(lines);
    const elapsed = Date.now() - streamStartTime;
    const secs = Math.floor(elapsed / 1000);
    const mins = Math.floor(secs / 60);
    const statParts: string[] = [mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`];
    if (streamTokens > 0) statParts.push(`↓ ${fmtTokens(streamTokens)} tokens`);
    if (thinkingBuffer && thinkingDuration > 0 && !thinkingStartTime) {
      statParts.push(`reasoned ${thinkingDuration}s`);
    }
    const label = thinkingRequested
      ? "Thinking..."
      : "Composing...";
    lines.push(`  ${sparkleSpinner(spinnerFrame)} ${shimmerText(label, spinnerFrame)} ${colors.accent}(${statParts.join(" · ")})${colors.reset}`);
    if (
      streamingActivitySummary?.trim()
      && toolExecutions.length === 0
      && (!currentActivityStep || currentActivityStep.label !== streamingActivitySummary.trim())
    ) {
      lines.push(`  ${colors.dim}${streamingActivitySummary.trim()}${colors.reset}`);
    } else if (thinkingRequested && !thinkingBuffer && elapsed >= 8000 && toolExecutions.length === 0) {
      lines.push(`  ${colors.dim}${streamingActivitySummary?.trim() || "waiting for first visible event"}${colors.reset}`);
    }
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
