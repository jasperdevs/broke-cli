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

function formatContextPercentLabel(contextUsed: number): string {
  if (contextUsed <= 0) return "0%";
  if (contextUsed < 1) return "<1%";
  return `${Math.round(contextUsed)}%`;
}

function buildContextMeter(width: number, contextUsed: number, colors: SidebarFooterColors): string {
  const percent = formatContextPercentLabel(contextUsed);
  const available = Math.max(6, width - percent.length - 2);
  const fillWidth = Math.max(1, Math.min(14, available));
  const filled = Math.max(0, Math.min(fillWidth, Math.round((Math.max(0, contextUsed) / 100) * fillWidth)));
  const empty = Math.max(0, fillWidth - filled);
  const fillColor = contextUsed > 90 ? colors.error : contextUsed > 70 ? colors.warning : colors.accent;
  const fill = filled > 0 ? `${fillColor}${"█".repeat(filled)}${RESET}` : "";
  const rest = empty > 0 ? `${colors.muted}${"░".repeat(empty)}${RESET}` : "";
  return `${colors.muted}▕${RESET}${fill}${rest}${colors.muted}▏${RESET} ${fillColor}${percent}${RESET}`;
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
  contextTokens?: string;
  colors: SidebarFooterColors;
}): string[] {
  const { width, tokenParts, contextUsed, contextTokens, colors } = options;
  const lines: string[] = [];

  for (const part of tokenParts) {
    lines.push(`${colors.muted}${part}${RESET}`);
  }

  if (contextUsed !== undefined && contextTokens) {
    const contextColor = contextUsed > 90 ? colors.error : contextUsed > 70 ? colors.warning : colors.muted;
    lines.push(`${contextColor}live ${contextTokens}${RESET}`);
    lines.push(buildContextMeter(width, contextUsed, colors));
  }

  return lines;
}
