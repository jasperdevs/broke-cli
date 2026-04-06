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
}

function formatContextPercentLabel(contextPercent: number): string {
  if (contextPercent <= 0) return "0%";
  if (contextPercent < 1) return "<1%";
  return `${Math.round(contextPercent)}%`;
}

function buildContextMeter(width: number, contextPercent: number, colors: SidebarFooterColors): string {
  const percent = formatContextPercentLabel(contextPercent);
  const available = Math.max(4, width - percent.length - 8);
  const fillWidth = Math.max(4, Math.min(8, available));
  const filled = Math.max(0, Math.min(fillWidth, Math.round((Math.max(0, contextPercent) / 100) * fillWidth)));
  const empty = Math.max(0, fillWidth - filled);
  const fillColor = contextPercent > 90 ? colors.error : contextPercent > 70 ? colors.warning : colors.accent;
  const fill = filled > 0 ? `${fillColor}${"█".repeat(filled)}${RESET}` : "";
  const rest = empty > 0 ? `${colors.muted}${"░".repeat(empty)}${RESET}` : "";
  return `${colors.muted}[${RESET}${fill}${rest}${colors.muted}]${RESET} ${fillColor}${percent}${RESET}`;
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
  const { width, tokenParts, contextUsed, contextTokens, colors } = options;
  const lines: string[] = [];

  for (const part of tokenParts) {
    lines.push(`${colors.muted}${part}${RESET}`);
  }

  if (contextUsed !== undefined && contextTokens) {
    const contextColor = contextUsed > 90 ? colors.error : contextUsed > 70 ? colors.warning : colors.text;
    lines.push(`${contextColor}${contextTokens} context${RESET}`);
    lines.push(buildContextMeter(width, contextUsed, colors));
  }

  return lines;
}
