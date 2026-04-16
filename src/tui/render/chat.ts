import { renderPrefixedWrappedLines, toolArgumentSummary, toolDescription, wrapVisibleText } from "./tool-render.js";
import { visibleWidth } from "../../utils/terminal-width.js";
import type { PendingDelivery } from "../../ui-contracts.js";
import type { TodoItem } from "../../tools/todo.js";

export type TodoRenderItem = TodoItem;

export interface PendingRenderMessage {
  text: string;
  delivery: PendingDelivery;
}

const PENDING_PREVIEW_LIMIT = 3;

function pushPreview(lines: string[], text: string, maxWidth: number, dim: string, reset: string, italic = false): void {
  const sourceLines = text.trim().split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  let count = 0;
  for (const line of sourceLines.length > 0 ? sourceLines : [""]) {
    for (const wrappedLine of wrapVisibleText(line, Math.max(8, maxWidth - 8))) {
      if (count >= PENDING_PREVIEW_LIMIT) {
        lines.push(`  ${dim}    ...${reset}`);
        return;
      }
      lines.push(`  ${dim}↳ ${italic ? "\x1b[3m" : ""}${wrappedLine}${italic ? "\x1b[23m" : ""}${reset}`);
      count++;
    }
  }
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
      pushPreview(lines, item.text, maxWidth, dim, reset);
    }
  }

  if (followUpItems.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`  ${dim}• Queued follow-up messages${reset}`);
    for (const item of followUpItems.slice(-4)) {
      pushPreview(lines, item.text, maxWidth, dim, reset, true);
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
  void spinnerFrame;
  const statusColor = tc.status === "failed"
    ? colors.error
    : done
      ? colors.muted
      : colors.accent2;
  const stateText = tc.status === "starting" ? "run" : tc.status === "running" ? "run" : tc.status === "failed" ? "fail" : "done";
  const statusIcon = `${statusColor}[${stateText}]${reset}`;
  const statusLabel = tc.status === "starting" ? "starting" : tc.status;
  const elapsedLabel = formatElapsedLabel(tc);
  const statusSuffix = `${colors.muted}${statusLabel}${elapsedLabel ? ` · ${elapsedLabel}` : ""}${reset}`;
  const activeDetailColor = running ? colors.accent2 : colors.muted;
  const ordinal = typeof index === "number" ? `${colors.muted}${index + 1}.${reset} ` : "";
  const firstPrefix = `  ${ordinal}${statusIcon} `;
  const continuationPrefix = "    ";
  const headerWidth = Math.max(8, maxWidth - visibleWidth(firstPrefix) - 1);
  const wrappedHeader = wrapVisibleText(toolDescription(tc), headerWidth);
  wrappedHeader.forEach((line, headerIndex) => {
    const prefix = headerIndex === 0 ? firstPrefix : continuationPrefix;
    const suffix = headerIndex === wrappedHeader.length - 1 ? ` ${statusSuffix}` : "";
    lines.push(`${prefix}${done ? colors.muted : colors.text}${line}${reset}${suffix}`);
  });

  const a = tc.args as Record<string, string> | undefined;

  if (running && tc.preview === "..." && !tc.streamOutput) {
    lines.push(`${activeDetailColor}  ${branch} waiting for tool details...${reset}`);
  }

  const argSummary = toolArgumentSummary(tc);
  if (argSummary && (running || (!done && !tc.resultDetail))) {
    for (const wrappedLine of renderPrefixedWrappedLines(`  ${branch} `, argSummary, maxWidth)) {
      lines.push(`${activeDetailColor}${wrappedLine}${reset}`);
    }
  }

  if (running && tc.streamOutput) {
    const outLines = tc.streamOutput.split("\n").filter((line) => line.trim());
    const tail = outLines.slice(-5);
    for (const line of tail) {
      for (const wrappedLine of renderPrefixedWrappedLines(`  ${branch} `, line, maxWidth)) {
        lines.push(`${activeDetailColor}${wrappedLine}${reset}`);
      }
    }
    if (outLines.length > 5) lines.push(`${activeDetailColor}  ${branch} ... +${outLines.length - 5} lines${reset}`);
  }

  if (done) {
    if (tc.name === "editFile" && a && (a.old_string || Array.isArray((a as any).edits))) {
      const editPairs = Array.isArray((a as any).edits) && (a as any).edits.length > 0
        ? (a as any).edits.map((edit: any) => ({ oldText: String(edit.oldText ?? ""), newText: String(edit.newText ?? "") }))
        : [{ oldText: String(a.old_string ?? ""), newText: String(a.new_string ?? "") }];
      const diffW = maxWidth - 6;
      const oldLines = editPairs.flatMap((edit: { oldText: string }) => edit.oldText.split("\n"));
      const newLines = editPairs.flatMap((edit: { newText: string }) => edit.newText.split("\n"));
      lines.push(`${colors.muted}  ${branch} ${tc.resultDetail || `+${newLines.length} -${oldLines.length} lines`}${reset}`);
      for (const [editIndex, edit] of editPairs.slice(0, 3).entries()) {
        if (editPairs.length > 1) lines.push(`${colors.muted}      hunk ${editIndex + 1}${reset}`);
        for (const line of edit.oldText.split("\n").slice(0, 3)) {
          const text = `- ${line}`.slice(0, diffW - 2);
          lines.push(`  ${colors.diffRemoveBg} ${text}${" ".repeat(Math.max(0, diffW - 2 - text.length))} ${reset}`);
        }
        for (const line of edit.newText.split("\n").slice(0, 3)) {
          const text = `+ ${line}`.slice(0, diffW - 2);
          lines.push(`  ${colors.diffAddBg} ${text}${" ".repeat(Math.max(0, diffW - 2 - text.length))} ${reset}`);
        }
      }
      if (editPairs.length > 3) lines.push(`${colors.muted}      ... +${editPairs.length - 3} more hunks${reset}`);
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
    } else if (tc.streamOutput) {
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
  const hasActiveWork = !!currentActivityStep || toolExecutions.some((tc) => tc.status === "starting" || tc.status === "running");
  lines.push(`  ${hasActiveWork ? colors.accent : colors.dim}${toolExecutions.length > 0 ? "actions" : "status"}${colors.reset}`);
  if (currentActivityStep && toolExecutions.length === 0) {
    const icon = currentActivityStep.status === "done"
      ? `${colors.dim}[done]${colors.reset}`
      : `${colors.accent}[run]${colors.reset}`;
    const elapsed = formatElapsedLabel(currentActivityStep);
    const prefix = `  ${icon} `;
    const wrapped = wrapVisibleText(currentActivityStep.label, Math.max(8, maxWidth - visibleWidth("  [run] ") - 1));
    wrapped.forEach((line, idx) => {
      const suffix = idx === wrapped.length - 1 && elapsed ? ` ${colors.dim}${elapsed}${colors.reset}` : "";
      lines.push(`${idx === 0 ? prefix : "    "}${colors.text}${line}${colors.reset}${suffix}`);
    });
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
    const allDone = done === total;

    if (isStreaming) {
      const elapsed = Date.now() - streamStartTime;
      const secs = Math.floor(elapsed / 1000);
      const mins = Math.floor(secs / 60);
      const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
      const inProgress = todoItems.find((item) => item.status === "in_progress");
      const headerText = inProgress ? inProgress.text : (allDone ? "Done" : "Working");
      lines.push(`  ${colors.accent}[run]${colors.reset} ${colors.accent}${headerText}${colors.reset}  ${colors.dim}${timeStr} · ${done}/${total}${colors.reset}`);
    } else {
      lines.push(`  ${allDone ? colors.dim : colors.accent}${allDone ? "[done]" : "[run]"}${colors.reset} ${colors.dim}tasks ${done}/${total}${colors.reset}`);
    }

    for (let i = 0; i < todoItems.length; i++) {
      const item = todoItems[i];
      const branch = i === todoItems.length - 1 ? "\u2514" : "\u251C";
      const icon = item.status === "done" ? `${colors.dim}[done]${colors.reset}`
        : item.status === "in_progress" ? `${colors.accent}[run]${colors.reset}`
        : `${colors.dim}[wait]${colors.reset}`;
      const textColor = item.status === "done" ? colors.dim : item.status === "in_progress" ? `${colors.text}${colors.bold}` : colors.dim;
      const todoPrefixPlain = `  ${branch} `;
      const branchColor = item.status === "in_progress" ? colors.accent : colors.dim;
      const todoPrefixStyled = `  ${branchColor}${branch}${colors.reset} ${icon} `;
      const todoWrapWidth = Math.max(8, maxWidth - visibleWidth(todoPrefixPlain) - 6);
      wrapVisibleText(item.text, todoWrapWidth).forEach((wrappedLine, wrappedIndex) => {
        lines.push(`${wrappedIndex === 0 ? todoPrefixStyled : "      "}${textColor}${wrappedLine}${colors.reset}`);
      });
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
      : "Working";
    lines.push(`  ${sparkleSpinner(spinnerFrame, colors.accent)} ${shimmerText(label, spinnerFrame, colors.accent)} ${colors.accent}(${statParts.join(" · ")})${colors.reset}`);
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
