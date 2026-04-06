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

export function loadSidebarFileTree(cwd: string): SidebarTreeItem[] {
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
    const items: SidebarTreeItem[] = [];
    for (const dir of [...dirContents.keys()].sort()) {
      const children = dirContents.get(dir)!.sort().map((child) => child.includes("/") ? child.split("/").pop()! : child);
      items.push({ name: dir, isDir: true, children, depth: 0 });
    }
    for (const file of topFiles.sort()) {
      items.push({ name: file, isDir: false, depth: 0 });
    }
    return items;
  } catch {
    try {
      return readdirSync(cwd)
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
      return [];
    }
  }
}

export function buildSidebarFooterLines(options: {
  width: number;
  statusParts: string[];
  cost?: string;
  tokenParts: string[];
  contextUsed?: number;
  contextUsage?: string;
  colors: SidebarFooterColors;
}): string[] {
  const { width, statusParts, cost, tokenParts, contextUsed, contextUsage, colors } = options;
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

  if (cost && `${"Session"} · ${cost}`.length > width) {
    lines.push(`${colors.text}Session${RESET}`);
    lines.push(`  ${colors.muted}${cost}${RESET}`);
  } else {
    const headerParts = ["Session"];
    if (cost) headerParts.push(cost);
    lines.push(`${colors.text}${headerParts.join(` ${colors.muted}·${RESET} `)}${RESET}`);
  }

  for (const part of tokenParts) {
    lines.push(`  ${colors.muted}${part}${RESET}`);
  }

  if (contextUsed !== undefined && contextUsage) {
    const contextLabel = `${contextUsed}% prompt`;
    const contextColor = contextUsed > 90 ? colors.error : contextUsed > 70 ? colors.warning : colors.muted;
    if (`  ${contextLabel} · ${contextUsage}`.length > width) {
      lines.push(`  ${contextColor}${contextLabel}${RESET}`);
      lines.push(`  ${colors.muted}${contextUsage}${RESET}`);
    } else {
      lines.push(`  ${contextColor}${contextLabel}${RESET} ${colors.muted}· now ${contextUsage}${RESET}`);
    }
  }

  return lines;
}
