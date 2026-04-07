import { buildSidebarFooterLines } from "../sidebar.js";

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

  const compactModels = width < 28 || modelSlots.length > 4;
  const formatSlotLine = (label: string, value: string): string => {
    const available = Math.max(4, width - label.length - 1);
    const displayValue = value.length > available ? value.slice(0, available) : value;
    return `${colors.text}${label}${colors.reset} ${colors.accent}${displayValue}${colors.reset}`;
  };
  const lines: string[] = [];
  lines.push(`${colors.text}${colors.bold}${sessionName.slice(0, width - 2)}${colors.reset}`);
  lines.push(`${colors.muted}v${appVersion}${colors.reset}`);
  if (!compactModels) lines.push("");
  for (const slot of modelSlots) {
    if (compactModels) {
      lines.push(formatSlotLine(slot.label, slot.value));
      continue;
    }
    lines.push(`${colors.text}${slot.label}${colors.reset}`);
    lines.push(`  ${colors.accent}${slot.value}${colors.reset}`);
  }
  if (!compactModels) lines.push("");

  if (mcpConnections.length > 0) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(`${colors.text}MCP${colors.reset}`);
    for (const connection of mcpConnections.slice(0, 3)) {
      lines.push(`  ${colors.success}\u25CF${colors.reset} ${colors.muted}${connection.slice(0, width - 6)}${colors.reset}`);
    }
  }

  if (!compactModels && lines[lines.length - 1] !== "") lines.push("");
  lines.push(`${colors.text}Directory${colors.reset}`);
  lines.push(`  ${colors.muted}${shortCwd}${colors.reset}`);
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
