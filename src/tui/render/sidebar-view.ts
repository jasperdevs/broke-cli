import type { SidebarTreeItem } from "../sidebar.js";
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
  };
}): string[] {
  const { showTokens, width, statusParts, tokenParts, contextUsed, contextTokens, colors } = options;
  if (!showTokens) return [];
  const footer = buildSidebarFooterLines({
    width,
    statusParts,
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
  providerName: string;
  modelName: string;
  detectedProviders: string[];
  mcpConnections: string[];
  shortCwd: string;
  gitBranch: string;
  gitDirty: boolean;
  sidebarTreeOpen: boolean;
  sidebarFileTree: SidebarTreeItem[] | null;
  sidebarExpandedDirs: Set<string>;
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
    providerName,
    modelName,
    detectedProviders,
    mcpConnections,
    shortCwd,
    gitBranch,
    gitDirty,
    sidebarTreeOpen,
    sidebarFileTree,
    sidebarExpandedDirs,
    colors,
  } = options;

  const lines: string[] = [];
  lines.push(`${colors.text}${colors.bold}${sessionName.slice(0, width - 2)}${colors.reset}`);
  lines.push(`${colors.muted}v${appVersion}${colors.reset}`);
  lines.push("");
  lines.push(`${colors.accent}${providerName}/${modelName}${colors.reset}`);
  lines.push("");

  if (detectedProviders.length > 0) {
    lines.push(`${colors.text}Providers${colors.reset}`);
    for (const provider of detectedProviders.slice(0, 4)) lines.push(`  ${colors.muted}${provider}${colors.reset}`);
    if (detectedProviders.length > 4) lines.push(`  ${colors.muted}+${detectedProviders.length - 4} more${colors.reset}`);
  }

  if (mcpConnections.length > 0) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(`${colors.text}MCP${colors.reset}`);
    for (const connection of mcpConnections.slice(0, 3)) {
      lines.push(`  ${colors.success}\u25CF${colors.reset} ${colors.muted}${connection.slice(0, width - 6)}${colors.reset}`);
    }
  }

  if (lines[lines.length - 1] !== "") lines.push("");
  lines.push(`${colors.text}Directory${colors.reset}`);
  lines.push(`  ${colors.muted}${shortCwd}${colors.reset}`);
  if (gitBranch) lines.push(`  ${colors.muted}${gitBranch}${gitDirty ? " *" : ""}${colors.reset}`);
  lines.push("");

  const treeArrow = sidebarTreeOpen ? "▾" : "▸";
  lines.push(`${colors.text}${treeArrow} Files${colors.reset}`);
  if (sidebarTreeOpen) {
    const tree = sidebarFileTree ?? [];
    for (const item of tree) {
      if (item.isDir) {
        const expanded = sidebarExpandedDirs.has(item.name);
        const arrow = expanded ? "▾" : "▸";
        const display = item.name.length > width - 6 ? item.name.slice(-(width - 7)) : item.name;
        lines.push(`  ${colors.accent}${arrow} ${display}/${colors.reset}`);
        if (expanded && item.children) {
          const showCount = sidebarExpandedDirs.has(`${item.name}:all`) ? item.children.length : Math.min(item.children.length, 4);
          for (let i = 0; i < showCount; i++) {
            const child = item.children[i];
            const cDisplay = child.length > width - 8 ? child.slice(-(width - 9)) : child;
            lines.push(`    ${colors.muted}${cDisplay}${colors.reset}`);
          }
          if (showCount < item.children.length) {
            lines.push(`    ${colors.muted}▸ +${item.children.length - showCount} more${colors.reset}`);
          }
        }
      } else {
        const display = item.name.length > width - 4 ? item.name.slice(-(width - 5)) : item.name;
        lines.push(`  ${colors.muted}${display}${colors.reset}`);
      }
    }
  }

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
