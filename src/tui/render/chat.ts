export interface ToolCallRenderGroup {
  name: string;
  preview: string;
  args?: unknown;
  resultDetail?: string;
  result?: string;
  error?: boolean;
  expanded: boolean;
  streamOutput?: string;
}

export interface TodoRenderItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "done";
}

export function toolDescription(tc: ToolCallRenderGroup): string {
  const a = tc.args as Record<string, string> | undefined;
  switch (tc.name) {
    case "readFile": return `Reading ${tc.preview}`;
    case "listFiles": return `Listing ${tc.preview}`;
    case "grep": return `Searching for ${a?.pattern ? `"${a.pattern}"` : "pattern"}`;
    case "writeFile": return `Writing ${tc.preview}`;
    case "editFile": return `Updating ${tc.preview}`;
    case "bash": return `Running \`${tc.preview}\``;
    case "webSearch": return `Searching web for "${a?.query ?? tc.preview}"`;
    case "webFetch": return `Fetching ${a?.url ?? tc.preview}`;
    case "askUser": return `Asking: ${a?.question ?? tc.preview}`;
    case "todoWrite": return "Updating task list";
    default: return `${tc.name} ${tc.preview}`;
  }
}

export function renderToolCallBlock(options: {
  tc: ToolCallRenderGroup;
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
  const { tc, maxWidth, spinnerFrame, colors, reset } = options;
  const lines: string[] = [];
  const done = !!tc.result;
  const running = !done;
  const branch = "\u2514";

  const icon = tc.error ? `${colors.error}\u25CF${reset}`
    : done ? `${colors.muted}\u25CF${reset}`
    : (spinnerFrame % 2 === 0 ? `${colors.ok}\u25CF${reset}` : `${colors.accent2}\u25CF${reset}`);

  lines.push(`  ${icon} ${done ? colors.muted : colors.text}${toolDescription(tc)}${running ? "..." : ""}${reset}`);

  const a = tc.args as Record<string, string> | undefined;

  if (tc.name === "bash" && running && tc.streamOutput) {
    const outLines = tc.streamOutput.split("\n").filter((line) => line.trim());
    const tail = outLines.slice(-5);
    for (const line of tail) lines.push(`${colors.muted}  ${branch} ${line.slice(0, maxWidth - 6)}${reset}`);
    if (outLines.length > 5) lines.push(`${colors.muted}  ${branch} ... +${outLines.length - 5} lines${reset}`);
  }

  if (done) {
    if (tc.name === "editFile" && a?.old_string && a?.new_string) {
      const oldLines = a.old_string.split("\n");
      const newLines = a.new_string.split("\n");
      const diffW = maxWidth - 6;
      lines.push(`${colors.muted}  ${branch} +${newLines.length} -${oldLines.length} lines${reset}`);
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
      lines.push(`${colors.muted}  ${branch} ${newLines.length} lines written${reset}`);
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
        for (const line of showLines) lines.push(`${colors.muted}  ${branch} ${line.slice(0, maxWidth - 6)}${reset}`);
      } else {
        const tail = outLines.slice(-3);
        for (const line of tail) lines.push(`${colors.muted}  ${branch} ${line.slice(0, maxWidth - 6)}${reset}`);
        if (outLines.length > 3) lines.push(`${colors.muted}  ${branch} ... +${outLines.length - 3} lines (ctrl+o to expand)${reset}`);
      }
    } else if (tc.resultDetail) {
      lines.push(`${colors.muted}  ${branch} ${tc.resultDetail.slice(0, maxWidth - 6)}${reset}`);
    }
  }

  if (tc.error && tc.result) lines.push(`${colors.error}  ${branch} ${tc.result}${reset}`);
  return lines;
}

export function renderMessageOverlays(options: {
  staticLines: string[];
  maxWidth: number;
  thinkingBuffer: string;
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
    thinkingBuffer,
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
    fmtTokens,
    sparkleSpinner,
    shimmerText,
    colors,
  } = options;

  const lines = [...staticLines];

  if (thinkingBuffer) {
    const thinkLines = thinkingBuffer.split("\n").slice(-8);
    lines.push(`  ${colors.accent}${isStreaming ? "thinking" : "thought"}${colors.reset}`);
    for (const line of thinkLines) lines.push(`  ${colors.dim}${line.slice(0, maxWidth - 4)}${colors.reset}`);
    lines.push("");
  }

  if (todoItems.length > 0) {
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
    const elapsed = Date.now() - compactStartTime;
    const secs = Math.floor(elapsed / 1000);
    const mins = Math.floor(secs / 60);
    const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
    const tokenStr = compactTokens > 0 ? ` ↑ ${fmtTokens(compactTokens)} tokens` : "";
    lines.push(`  ${sparkleSpinner(spinnerFrame, colors.warn)} ${shimmerText("Compacting conversation...", spinnerFrame, colors.warn)} ${colors.dim}(${timeStr}${tokenStr ? ` ·${tokenStr}` : ""})${colors.reset}`);
    lines.push("");
  }

  if (isStreaming) {
    const elapsed = Date.now() - streamStartTime;
    const secs = Math.floor(elapsed / 1000);
    const mins = Math.floor(secs / 60);
    const statParts: string[] = [mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`];
    if (streamTokens > 0) statParts.push(`↓ ${fmtTokens(streamTokens)} tokens`);
    if (thinkingStartTime > 0) {
      const thinkSecs = Math.floor((Date.now() - thinkingStartTime) / 1000);
      if (thinkSecs > 0) statParts.push(`thinking ${thinkSecs}s`);
    } else if (thinkingDuration > 0) {
      statParts.push(`thought for ${thinkingDuration}s`);
    }
    const label = thinkingBuffer ? "Thinking..." : "Composing...";
    lines.push(`  ${sparkleSpinner(spinnerFrame)} ${shimmerText(label, spinnerFrame)} ${colors.accent}(${statParts.join(" · ")})${colors.reset}`);
    lines.push("");
  }

  return lines;
}
