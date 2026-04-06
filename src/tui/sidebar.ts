import { execSync } from "child_process";
import { readdirSync, statSync } from "fs";
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

function formatContextPercent(contextUsed: number): string {
  if (contextUsed <= 0) return "0% of limit";
  if (contextUsed < 1) return "<1% of limit";
  return `${Math.round(contextUsed)}% of limit`;
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
    const files = execSync("git ls-files --others --cached --exclude-standard", { cwd, encoding: "utf-8", timeout: 2000 }).trim();
    const raw = files.split("\n").filter(Boolean);
    const dirContents = new Map<string, string[]>();
    const topFiles: string[] = [];
    for (const f of raw) {
      const slash = f.indexOf("/");
      if (slash > 0) {
        const dir = f.slice(0, slash);
        if (!dirContents.has(dir)) dirContents.set(dir, []);
        dirContents.get(dir)!.push(f.slice(slash + 1));
      } else {
        topFiles.push(f);
      }
    }
    for (const dir of [...dirContents.keys()].sort()) {
      const children = dirContents.get(dir)!.sort().map((child) => child.includes("/") ? child.split("/").pop()! : child);
      items.push({ name: dir, isDir: true, children, depth: 0 });
    }
    for (const file of topFiles.sort()) {
      items.push({ name: file, isDir: false, depth: 0 });
    }
  } catch {
    try {
      items = readdirSync(cwd)
        .filter((file) => !file.startsWith(".") && file !== "node_modules")
        .map((file) => ({
          name: file,
          isDir: (() => {
            try {
              return statSync(join(cwd, file)).isDirectory();
            } catch {
              return false;
            }
          })(),
          children: undefined,
          depth: 0,
        }))
        .slice(0, 30);
    } catch {
      items = [];
    }
  }
  fileTreeCache.set(cwd, { at: Date.now(), items });
  return items;
}

export function buildSidebarFooterLines(options: {
  width: number;
  statusParts: string[];
  tokenParts: string[];
  contextUsed?: number;
  contextUsage?: string;
  colors: SidebarFooterColors;
}): string[] {
  const { width, statusParts, tokenParts, contextUsed, contextUsage, colors } = options;
  const lines: string[] = [];

  if (statusParts.length > 0) {
    const wrappedStatusParts: string[][] = [];
    let currentLine: string[] = [];
    for (const part of statusParts) {
      const nextPlain = currentLine.length === 0 ? part : `${currentLine.join(" · ")} · ${part}`;
      if (nextPlain.length > width && currentLine.length > 0) {
        wrappedStatusParts.push(currentLine);
        currentLine = [part];
      } else {
        currentLine.push(part);
      }
    }
    if (currentLine.length > 0) wrappedStatusParts.push(currentLine);
    for (const statusLine of wrappedStatusParts) {
      lines.push(`${colors.accent}${statusLine.join(` ${colors.muted}·${colors.accent} `)}${RESET}`);
    }
  }

  for (const part of tokenParts) {
    lines.push(`${colors.muted}${part}${RESET}`);
  }

  if (contextUsed !== undefined && contextUsage) {
    const contextColor = contextUsed > 90 ? colors.error : contextUsed > 70 ? colors.warning : colors.muted;
    lines.push(`${contextColor}${contextUsage}${RESET}`);
    lines.push(`${contextColor}${formatContextPercent(contextUsed)}${RESET}`);
  }

  return lines;
}
