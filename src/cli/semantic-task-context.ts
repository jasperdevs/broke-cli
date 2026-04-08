import { existsSync, readFileSync, realpathSync } from "fs";
import { join, resolve, relative, normalize as normalizeFsPath } from "path";
import type { SessionRepoState } from "../core/session-types.js";

const MAX_CONTEXT_FILE_BYTES = 32_000;
const MAX_CONTEXT_LINES = 120;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function resolveWorkspaceRelativePath(cwd: string, maybeRelativePath: string): string | null {
  const normalized = normalizePath(maybeRelativePath);
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  const resolved = resolve(cwd, normalizeFsPath(normalized));
  const rel = normalizePath(relative(cwd, resolved));
  if (!rel || rel.startsWith("../") || rel === "..") return null;
  return rel;
}

function resolveWorkspaceFilePath(cwd: string, relativePath: string): string | null {
  const workspaceRoot = realpathSync(cwd);
  const fullPath = join(cwd, relativePath);
  if (!existsSync(fullPath)) return null;
  try {
    const canonical = realpathSync(fullPath);
    const rel = normalizePath(relative(workspaceRoot, canonical));
    if (!rel || rel.startsWith("../") || rel === "..") return null;
    return rel;
  } catch {
    return null;
  }
}

function extractExplicitPaths(userMessage: string): string[] {
  return [...new Set(userMessage.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [])];
}

function shouldUseSemanticContext(userMessage: string): boolean {
  return /\b(fix|bug|broken|error|failing|debug|test|tests|coverage|spec|regression|write|implement|update|change)\b/i.test(userMessage);
}

function readSnippet(fullPath: string): string | null {
  try {
    const content = readFileSync(fullPath, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_CONTEXT_FILE_BYTES) return null;
    const lines = content.split("\n");
    if (lines.length > MAX_CONTEXT_LINES) {
      return `${lines.slice(0, MAX_CONTEXT_LINES).join("\n")}\n[... ${lines.length - MAX_CONTEXT_LINES} more lines omitted ...]`;
    }
    return content;
  } catch {
    return null;
  }
}

function pickTargetPaths(cwd: string, userMessage: string, repoState?: SessionRepoState | null): string[] {
  const explicitExisting = extractExplicitPaths(userMessage)
    .map((path) => resolveWorkspaceRelativePath(cwd, path))
    .filter((relativePath): relativePath is string => !!relativePath)
    .map((relativePath) => resolveWorkspaceFilePath(cwd, relativePath))
    .filter((relativePath): relativePath is string => !!relativePath);
  if (explicitExisting.length > 0) return explicitExisting.slice(0, 2);
  if (!repoState?.recentEdits.length || !/\b(test|tests|coverage|spec|regression)\b/i.test(userMessage)) return [];
  return repoState.recentEdits
    .map((entry) => resolveWorkspaceRelativePath(cwd, entry.path))
    .filter((relativePath): relativePath is string => !!relativePath)
    .map((relativePath) => resolveWorkspaceFilePath(cwd, relativePath))
    .filter((relativePath): relativePath is string => !!relativePath)
    .slice(0, 1);
}

export function buildSemanticTaskContext(options: {
  cwd: string;
  userMessage: string;
  repoState?: SessionRepoState | null;
}): { transcriptNote: string; promptBlock: string; targetPaths: string[] } | null {
  const { cwd, userMessage, repoState } = options;
  if (!shouldUseSemanticContext(userMessage)) return null;
  const targetPaths = pickTargetPaths(cwd, userMessage, repoState);
  if (targetPaths.length === 0) return null;
  const blocks = targetPaths
    .map((relativePath) => {
      const snippet = readSnippet(join(cwd, relativePath));
      return snippet ? `--- @target:${relativePath} ---\n${snippet}` : null;
    })
    .filter((entry): entry is string => !!entry);
  if (blocks.length === 0) return null;
  return {
    transcriptNote: `[target file context available only for this turn] ${targetPaths.join(", ")}`,
    promptBlock: `Known target files for this task: ${targetPaths.join(", ")}\nUse this context before exploring again.\n\n${blocks.join("\n\n")}`,
    targetPaths,
  };
}
