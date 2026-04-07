import { buildSidebarFooterLines } from "../sidebar.js";
import { wordWrap } from "./formatting.js";

function truncateWithEllipsis(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function wrapSidebarValue(value: string, width: number, maxLines = 2): string[] {
  const wrapped = wordWrap(value, Math.max(8, width));
  if (wrapped.length <= maxLines) return wrapped;
  const visible = wrapped.slice(0, maxLines);
  visible[maxLines - 1] = truncateWithEllipsis(visible[maxLines - 1], Math.max(8, width));
  return visible;
}

function wrapSidebarPath(pathValue: string, width: number, maxLines = 2): string[] {
  if (!pathValue) return [];
  const tokens = pathValue.split(/([\\/])/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    if (current.length + token.length <= width) {
      current += token;
      continue;
    }
    if (current) {
      lines.push(current);
      current = token === "\\" || token === "/" ? token : token.trimStart();
      continue;
    }
    lines.push(truncateWithEllipsis(token, width));
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, maxLines);
  trimmed[maxLines - 1] = truncateWithEllipsis(trimmed[maxLines - 1], width);
  return trimmed;
}

export function buildSidebarFooter(options: {
  width: number;
  showTokens: boolean;
  statusParts: string[];
  tokenParts: string[];
  contextUsed?: number;
  contextTokens?: string;
  colors: {
    accent: string;
    muted: string;
    text: string;
    warning: string;
    error: string;
    dim: string;
  };
}): string[] {
  const { showTokens, width, tokenParts, contextUsed, contextTokens, colors } = options;
  if (!showTokens) return [];
  const footer = buildSidebarFooterLines({
    width,
    statusParts: [],
    tokenParts,
    contextUsed,
    contextTokens,
    colors,
  });
  return footer.length > 0 ? ["", ...footer] : footer;
}

export function buildSidebarLines(options: {
  width: number;
  sessionName: string;
  appVersion: string;
  modelSlots: Array<{ label: string; value: string }>;
  mcpConnections: string[];
  shortCwd: string;
  gitBranch: string;
  gitDirty: boolean;
  colors: {
    text: string;
    muted: string;
    accent: string;
    success: string;
    bold: string;
    reset: string;
  };
}): string[] {
  const {
    width,
    sessionName,
    appVersion,
    modelSlots,
    mcpConnections,
    shortCwd,
    gitBranch,
    gitDirty,
    colors,
  } = options;

  const bodyWidth = Math.max(10, width - 2);
  const versionText = `v${appVersion}`;
  const sessionWidth = Math.max(6, width - versionText.length - 1);
  const sessionDisplay = truncateWithEllipsis(sessionName, sessionWidth);
  const lines: string[] = [];
  lines.push("");
  lines.push(`${colors.text}${colors.bold}${sessionDisplay}${colors.reset} ${colors.muted}${versionText}${colors.reset}`);
  lines.push("");
  for (const slot of modelSlots) {
    lines.push(`${colors.text}${slot.label}${colors.reset}`);
    for (const part of wrapSidebarValue(slot.value, bodyWidth, width < 24 ? 1 : 2)) {
      lines.push(`  ${colors.accent}${part}${colors.reset}`);
    }
  }
  if (mcpConnections.length > 0) {
    lines.push("");
    lines.push(`${colors.text}MCP${colors.reset}`);
    for (const connection of mcpConnections.slice(0, 3)) {
      for (const [index, part] of wrapSidebarValue(connection, Math.max(8, bodyWidth - 2), 2).entries()) {
        if (index === 0) lines.push(`  ${colors.success}\u25CF${colors.reset} ${colors.muted}${part}${colors.reset}`);
        else lines.push(`    ${colors.muted}${part}${colors.reset}`);
      }
    }
  }

  lines.push("");
  lines.push(`${colors.text}Directory${colors.reset}`);
  for (const part of wrapSidebarPath(shortCwd, bodyWidth, 2)) {
    lines.push(`  ${colors.muted}${part}${colors.reset}`);
  }
  if (gitBranch) lines.push(`  ${colors.muted}${gitBranch}${gitDirty ? " *" : ""}${colors.reset}`);

  return lines;
}

export function renderSidebarViewport(options: {
  allLines: string[];
  visibleHeight: number;
  sidebarScrollOffset: number;
  sidebarFocused: boolean;
  muted: string;
  reset: string;
}): { lines: string[]; scrollOffset: number } {
  const { allLines, visibleHeight, sidebarFocused, muted, reset } = options;
  let scrollOffset = options.sidebarScrollOffset;
  const maxScroll = Math.max(0, allLines.length - visibleHeight);
  if (scrollOffset > maxScroll) scrollOffset = maxScroll;
  if (scrollOffset < 0) scrollOffset = 0;

  if (allLines.length <= visibleHeight) {
    return { lines: allLines, scrollOffset };
  }

  const visible = allLines.slice(scrollOffset, scrollOffset + visibleHeight);
  if (visible.length > 0) {
    if (scrollOffset > 0) visible[0] = `${muted}^ more${sidebarFocused ? " · scroll" : ""}${reset}`;
    if (scrollOffset + visibleHeight < allLines.length) {
      visible[visible.length - 1] = `${muted}v more${sidebarFocused ? " · scroll" : ""}${reset}`;
    }
  }
  return { lines: visible, scrollOffset };
}
