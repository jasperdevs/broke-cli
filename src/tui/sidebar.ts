import { readdirSync } from "fs";
import { join } from "path";
import { RESET } from "../utils/ansi.js";

export interface SidebarTreeItem {
  name: string;
  isDir: boolean;
  children?: string[];
  depth: number;
}

export interface SidebarFooterColors {
  accent: string;
  muted: string;
  text: string;
  warning: string;
  error: string;
  dim: string;
}

function formatContextPercentLabel(contextPercent: number): string {
  if (contextPercent <= 0) return "0%";
  if (contextPercent < 1) return "<1%";
  return `${Math.round(contextPercent)}%`;
}

function buildContextMeter(width: number, contextPercent: number, colors: SidebarFooterColors): string {
  const percent = formatContextPercentLabel(contextPercent);
  const available = Math.max(10, width - percent.length - 3);
  const fillWidth = Math.max(10, Math.min(16, available));
  const ratio = Math.max(0, Math.min(1, contextPercent / 100));
  const filled = ratio > 0
    ? Math.max(1, Math.min(fillWidth, Math.round(ratio * fillWidth)))
    : 0;
  const empty = Math.max(0, fillWidth - filled);
  const fillColor = contextPercent > 90 ? colors.error : contextPercent > 70 ? colors.warning : colors.accent;
  const fill = filled > 0 ? `${fillColor}${"▰".repeat(filled)}${RESET}` : "";
  const rest = empty > 0 ? `${colors.dim}${"▱".repeat(empty)}${RESET}` : "";
  return `${fill}${rest} ${fillColor}${percent}${RESET}`;
}

const fileTreeCache = new Map<string, { at: number; items: SidebarTreeItem[] }>();
const FILE_TREE_CACHE_TTL_MS = 3000;

export function loadSidebarFileTree(cwd: string): SidebarTreeItem[] {
  const cached = fileTreeCache.get(cwd);
  if (cached && Date.now() - cached.at < FILE_TREE_CACHE_TTL_MS) {
    return cached.items;
  }

  let items: SidebarTreeItem[] = [];
  try {
    const entries = readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.name !== "node_modules")
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 40);

    items = entries.map((entry) => {
      const path = join(cwd, entry.name);
      let children: string[] | undefined;
      if (entry.isDirectory()) {
        try {
          children = readdirSync(path, { withFileTypes: true })
            .filter((child) => child.name !== "node_modules")
            .sort((a, b) => {
              if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .slice(0, 40)
            .map((child) => child.isDirectory() ? `${child.name}/` : child.name);
        } catch {
          children = [];
        }
      }
      return {
        name: entry.name,
        isDir: entry.isDirectory(),
        children,
        depth: 0,
      };
    });
  } catch {
    items = [];
  }
  fileTreeCache.set(cwd, { at: Date.now(), items });
  return items;
}

export function buildSidebarFooterLines(options: {
  width: number;
  statusParts: string[];
  tokenParts: string[];
  contextUsed?: number;
  contextTokens?: string;
  colors: SidebarFooterColors;
}): string[] {
  const { width, statusParts, tokenParts, contextUsed, contextTokens, colors } = options;
  const lines: string[] = [];
  const costLine = tokenParts.find((part) => part.startsWith("$") || part === "local/unpriced");
  const valueLines = tokenParts.filter((part) => part !== costLine);
  const isZeroUsage = contextUsed === undefined
    && tokenParts.length > 0
    && tokenParts.every((part) => /^(?:\$0(?:\.0+)?|0 total|0 in|0 out|local\/unpriced)$/.test(part));

  if (isZeroUsage) {
    lines.push(`${colors.muted}${tokenParts.join(" · ")}${RESET}`);
    return lines;
  }

  if (costLine) {
    if (statusParts.length > 0) lines.push(`${colors.dim}${statusParts.join(" · ")}${RESET}`);
    if (statusParts.length > 0) lines.push("");
    lines.push(`${colors.text}${costLine}${RESET}`);
  }

  for (const part of valueLines) {
    lines.push(`${colors.muted}${part}${RESET}`);
  }

  if (!costLine && statusParts.length > 0) {
    lines.push(`${colors.dim}${statusParts.join(" · ")}${RESET}`);
  }

  if (contextTokens) {
    if (valueLines.length > 0 || costLine) lines.push("");
    lines.push(`${colors.text}${contextTokens} ctx${RESET}`);
    lines.push(contextUsed !== undefined ? buildContextMeter(width, contextUsed, colors) : `${colors.dim}${"▱".repeat(Math.max(10, Math.min(16, width - 6)))}${RESET} ${colors.dim}?${RESET}`);
  }

  return lines;
}
