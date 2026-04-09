import { execFileSync } from "child_process";
import { existsSync, statSync, readdirSync } from "fs";
import { join } from "path";
import type { Session } from "../core/session.js";
import type { TurnArchetype } from "../core/turn-policy.js";
import type { ToolName } from "../tools/registry.js";

export interface NativeWorkspaceBaseline {
  cwd: string;
  mtimes: Map<string, number>;
}

const IGNORE_PREFIXES = [".omx/", ".tmp/", "dist/", "coverage/", "node_modules/"];

function shouldTrackPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (IGNORE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  if (normalized.endsWith(".jsonl")) return false;
  return true;
}

function parseGitStatusPorcelain(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      if (entry.length < 4) return [];
      const path = entry.slice(3).trim();
      if (!path) return [];
      const renameParts = path.split(" -> ");
      return [renameParts[renameParts.length - 1]!].filter(shouldTrackPath);
    });
}

function getChangedFiles(cwd: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return [...new Set(parseGitStatusPorcelain(output))];
  } catch {
    return [];
  }
}

function collectWorkspaceFiles(cwd: string): string[] {
  const files: string[] = [];
  const visit = (relativeDir: string): void => {
    const fullDir = relativeDir ? join(cwd, relativeDir) : cwd;
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = readdirSync(fullDir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const normalized = relativePath.replace(/\\/g, "/");
      if (!shouldTrackPath(normalized)) continue;
      if (entry.isDirectory()) {
        visit(normalized);
        continue;
      }
      files.push(normalized);
    }
  };
  visit("");
  return files;
}

function getWorkspaceTrackedFiles(cwd: string): string[] {
  const gitFiles = getChangedFiles(cwd);
  if (gitFiles.length > 0) return gitFiles;
  return collectWorkspaceFiles(cwd);
}

export function captureNativeWorkspaceBaseline(cwd: string): NativeWorkspaceBaseline {
  const mtimes = new Map<string, number>();
  for (const relativePath of getWorkspaceTrackedFiles(cwd)) {
    const fullPath = join(cwd, relativePath);
    if (!existsSync(fullPath)) continue;
    try {
      mtimes.set(relativePath.replace(/\\/g, "/"), statSync(fullPath).mtimeMs);
    } catch {
      continue;
    }
  }
  return { cwd, mtimes };
}

export function recordNativeWorkspaceDelta(
  session: Session,
  baseline: NativeWorkspaceBaseline | null,
): string[] {
  if (!baseline) return [];
  const touched: string[] = [];
  const afterPaths = getWorkspaceTrackedFiles(baseline.cwd);
  for (const relativePath of afterPaths) {
    const normalized = relativePath.replace(/\\/g, "/");
    const fullPath = join(baseline.cwd, relativePath);
    let changed = !baseline.mtimes.has(normalized);
    if (!changed && existsSync(fullPath)) {
      try {
        changed = statSync(fullPath).mtimeMs !== baseline.mtimes.get(normalized);
      } catch {
        changed = true;
      }
    }
    if (!changed) continue;
    session.recordRepoEdit(normalized, "edit");
    touched.push(normalized);
  }
  return touched;
}

export function shouldExposeOpaqueNativeWorkspaceEdits(policy: {
  archetype: TurnArchetype;
  allowedTools: ToolName[];
}): boolean {
  if (policy.archetype !== "edit" && policy.archetype !== "bugfix") return false;
  return policy.allowedTools.includes("writeFile") || policy.allowedTools.includes("editFile");
}

type FollowupContextMode = "summary" | "snippets";

function buildRecentEditList(recentEdits: string[], maxFiles: number): string[] {
  return recentEdits
    .filter(shouldTrackPath)
    .slice(0, maxFiles)
    .map((relativePath) => relativePath.replace(/\\/g, "/"));
}

export function buildNativeFollowupStateContext(
  cwd: string,
  recentEdits: string[],
  maxFiles = 2,
  mode: FollowupContextMode = "summary",
): { transcriptNote: string; promptBlock: string } | null {
  const recentEditList = buildRecentEditList(recentEdits, maxFiles);
  if (recentEditList.length === 0) return null;
  if (mode === "summary") {
    const joined = recentEditList.join(", ");
    return {
      transcriptNote: `[recent edits available only for this turn] ${joined}`,
      promptBlock: `Recent edited files from the last turn: ${joined}\nReuse repo state first. Re-open files only if needed.`,
    };
  }

  const snippets = recentEditList
    .map((relativePath) => {
      const fullPath = join(cwd, relativePath);
      if (!existsSync(fullPath)) return null;
      try {
        const content = execFileSync("git", ["show", `HEAD:${relativePath}`], {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        });
        return `--- @recent-edit:${relativePath} ---\n${content}`;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is string => !!entry);
  if (snippets.length === 0) return null;
  return {
    transcriptNote: `[recent edit context available only for this turn] ${recentEditList.join(", ")}`,
    promptBlock: snippets.join("\n\n"),
  };
}
