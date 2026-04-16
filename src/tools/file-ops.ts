import { basename, dirname, join, relative } from "path";
import { createCheckpoint } from "../core/git.js";
import { checkFilesystemPathAccess, ensureNetworkAllowed } from "../core/permissions.js";
import { resolveReadPath, resolveToCwd } from "../core/path-utils.js";
import { localFileOperations, type EditOperations, type ListOperations, type ReadOperations, type SearchOperations, type WriteOperations } from "./file-operations.js";
import { fetchRemoteGitHubFile, listRemoteGitHubTree, tryParseRemoteGitHubTarget } from "./file-ops-remote.js";
import { truncation } from "./tool-metadata.js";
import {
  buildMemoizedReadSummary,
  buildReadMemoKey,
  findFirstMatchLine,
  getMemoContext,
  scoreSemanticMatch,
  tokenizeSearchQuery,
  type ReadMode,
} from "./file-ops-support.js";

/** Max chars to return from file reads (~1500 tokens) */
const MAX_READ_CHARS = 6000;
/** Max lines from grep matches */
const MAX_GREP_MATCHES = 18;
/** Max file entries from listFiles */
const MAX_LIST_FILES = 120;
/** Max semantic search results */
const MAX_SEM_SEARCH_RESULTS = 8;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".omx", ".tmp"]);

interface ReadFileDirectOptions {
  path: string; cwd?: string; offset?: number; limit?: number; mode?: ReadMode; tail?: number; refresh?: boolean; operations?: ReadOperations;
}

interface WalkFileOptions { dir: string; cwd: string; maxDepth: number; include?: string; operations: ListOperations; onFile: (fullPath: string) => boolean | void; }

function bufferToUtf8(value: Buffer | string): string { return typeof value === "string" ? value : value.toString("utf-8"); }

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeGlobPattern(include?: string): RegExp | null {
  if (!include?.trim()) return null;
  const pattern = include.trim().replace(/\\/g, "/");
  const regex = `^${pattern.split("*").map(escapeRegex).join(".*")}$`;
  return new RegExp(regex, "i");
}

function matchesInclude(filePath: string, include?: string): boolean {
  const matcher = normalizeGlobPattern(include);
  if (!matcher) return true;
  const normalized = filePath.replace(/\\/g, "/");
  return matcher.test(normalized) || matcher.test(basename(normalized));
}

function walkFiles({ dir, cwd, maxDepth, include, operations, onFile }: WalkFileOptions): void {
  const visit = (current: string, depth: number): boolean => {
    if (depth > maxDepth) return false;
    try {
      for (const entry of operations.readdir(current)) {
        if (entry.startsWith(".") && !entry.startsWith(".env")) continue;
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(current, entry);
        const stat = operations.stat(full);
        if (stat.isDirectory()) {
          if (visit(full, depth + 1)) return true;
          continue;
        }
        const rel = relative(cwd, full);
        if (!matchesInclude(rel, include)) continue;
        if (onFile(full) === true) return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  visit(dir, 0);
}

function stripNoiseLines(content: string, path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if ((ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx" || ext === "rs" || ext === "java" || ext === "go") && (trimmed.startsWith("//") || trimmed === "{" || trimmed === "}")) return false;
      if (ext === "py" && trimmed.startsWith("#")) return false;
      return true;
    })
    .join("\n");
}

function aggressiveCodeSummary(content: string, path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const patterns = [
    /^\s*(export\s+)?(async\s+)?function\b/,
    /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/,
    /^\s*(export\s+)?class\b/,
    /^\s*(export\s+)?interface\b/,
    /^\s*(export\s+)?type\b/,
    /^\s*def\b/,
    /^\s*class\b/,
    /^\s*fn\b/,
    /^\s*impl\b/,
    /^\s*import\b/,
    /^\s*from\b/,
    /^\s*use\b/,
  ];

  const lines = content.split("\n");
  const kept = lines.filter((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (index < 20) return true;
    return patterns.some((pattern) => pattern.test(line));
  });

  const summarized = kept.join("\n");
  if (summarized.trim()) return summarized;
  return stripNoiseLines(content, path);
}

function applyReadMode(content: string, path: string, mode: "full" | "minimal" | "aggressive"): string {
  if (mode === "minimal") return stripNoiseLines(content, path);
  if (mode === "aggressive") return aggressiveCodeSummary(content, path);
  return content;
}

function buildGrepSummary(matches: Array<{ file: string; line: number; text: string }>) {
  const grouped = matches.reduce<Record<string, Array<{ line: number; text: string }>>>((acc, match) => {
    if (!acc[match.file]) acc[match.file] = [];
    acc[match.file].push({ line: match.line, text: match.text });
    return acc;
  }, {});
  return Object.entries(grouped).map(([file, fileMatches]) => ({ file, count: fileMatches.length, examples: fileMatches.slice(0, 2) }));
}

export function readFileDirect({ path, cwd = process.cwd(), offset, limit, mode, tail, refresh, operations = localFileOperations }: ReadFileDirectOptions) {
  const access = checkFilesystemPathAccess(path, "read", cwd);
  if (!access.allowed) {
    return { success: false as const, error: access.reason ?? "Read not permitted." };
  }
  try {
    let filePath = resolveReadPath(path, cwd);
    if (filePath !== access.normalizedPath) {
      const variantAccess = checkFilesystemPathAccess(filePath, "read", cwd);
      if (!variantAccess.allowed) return { success: false as const, error: variantAccess.reason ?? "Read not permitted." };
      filePath = variantAccess.normalizedPath ?? filePath;
    }
    const fileStat = operations.stat(filePath);
    const readMode = mode ?? "full";
    const memoContext = getMemoContext();
    const memoKey = buildReadMemoKey({ path: filePath, offset, limit, mode: readMode, tail });
    const fingerprint = `${fileStat.mtimeMs}:${fileStat.size}`;
    if (!refresh) {
      const memoized = memoContext?.getMemoizedToolResult<{ totalLines: number; mode: ReadMode; firstSeenTurn: number }>(
        memoKey,
        fingerprint,
        1,
      );
      if (memoized) {
        return {
          success: true as const,
          path,
          content: buildMemoizedReadSummary(path, memoized),
          totalLines: memoized.totalLines,
          mode: memoized.mode,
          memoized: true as const,
        };
      }
    }

    const raw = bufferToUtf8(operations.readFile(filePath));
    let content = raw;
    const lines = raw.split("\n");

    if (tail !== undefined && tail > 0) {
      content = lines.slice(-tail).join("\n");
    } else if (offset !== undefined || limit !== undefined) {
      const start = offset ?? 0;
      const end = limit ? start + limit : lines.length;
      content = lines.slice(start, end).join("\n");
    }

    content = applyReadMode(content, path, readMode);
    const totalLines = lines.length;

    if (content.length > MAX_READ_CHARS) {
      content = content.slice(0, MAX_READ_CHARS);
      return { success: true as const, path, content, totalLines, truncated: true, mode: readMode, details: truncation("chars", content.length, MAX_READ_CHARS, raw.length), note: `File truncated in ${readMode} mode. Use offset/limit to read specific sections.` };
    }

    memoContext?.rememberToolResult(memoKey, fingerprint, {
      totalLines,
      mode: readMode,
      firstSeenTurn: memoContext.getCurrentTurn(),
    });

    return { success: true as const, path, content, totalLines, mode: readMode };
  } catch (err: unknown) {
    return { success: false as const, error: (err as Error).message };
  }
}

export function listFilesDirect({ path: dir = ".", cwd = process.cwd(), maxDepth, include, operations = localFileOperations }: { path?: string; cwd?: string; maxDepth?: number; include?: string; operations?: ListOperations }) {
  const access = checkFilesystemPathAccess(dir, "read", cwd);
  if (!access.allowed) {
    return { files: [], totalEntries: 0, truncated: false, error: access.reason };
  }
  const root = access.normalizedPath ?? resolveToCwd(dir, cwd);
  const memoContext = getMemoContext();
  const memoKey = ["list", root, maxDepth ?? 3, include ?? ""].join("|");
  const workspaceFingerprint = `${memoKey}|v${memoContext?.getWorkspaceVersion() ?? 0}`;
  const memoized = memoContext?.getMemoizedToolResult<{
    files: string[];
    totalEntries: number;
    truncated: boolean;
  }>(memoKey, workspaceFingerprint, 3);
  if (memoized) {
    return {
      ...memoized,
      memoized: true as const,
      note: "Reused unchanged file listing from an earlier turn.",
    };
  }
  const max = maxDepth ?? 3;
  const files: string[] = [];
  let totalEntries = 0;
  let capped = false;
  const visit = (current: string, depth: number): boolean => {
    if (depth > max) return false;
    try {
      for (const entry of operations.readdir(current)) {
        if (entry.startsWith(".") && !entry.startsWith(".env")) continue;
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(current, entry);
        const stat = operations.stat(full);
        const rel = relative(cwd, full);
        if (stat.isDirectory()) {
          totalEntries += 1;
          if (files.length < MAX_LIST_FILES) files.push(rel.replace(/\\/g, "/") + "/");
          if (totalEntries >= MAX_LIST_FILES) {
            capped = true;
            return true;
          }
          if (visit(full, depth + 1)) return true;
          continue;
        }
        if (!matchesInclude(rel, include)) continue;
        totalEntries += 1;
        if (files.length < MAX_LIST_FILES) files.push(rel.replace(/\\/g, "/"));
        if (totalEntries >= MAX_LIST_FILES) {
          capped = true;
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  };
  visit(root, 0);
  const result = { files, totalEntries, truncated: capped, details: capped ? truncation("entries", files.length, MAX_LIST_FILES, totalEntries) : undefined };
  memoContext?.rememberToolResult(memoKey, workspaceFingerprint, result);
  return result;
}

export function grepDirect({ pattern, path: dir = ".", cwd = process.cwd(), include, operations = localFileOperations }: { pattern: string; path?: string; cwd?: string; include?: string; operations?: SearchOperations }) {
  const access = checkFilesystemPathAccess(dir, "read", cwd);
  if (!access.allowed) {
    return {
      matches: [],
      summary: [],
      totalMatches: 0,
      capped: false,
      error: access.reason,
    };
  }
  const root = access.normalizedPath ?? resolveToCwd(dir, cwd);
  const memoContext = getMemoContext();
  const memoKey = ["grep", root, pattern, include ?? ""].join("|");
  const workspaceFingerprint = `${memoKey}|v${memoContext?.getWorkspaceVersion() ?? 0}`;
  const memoized = memoContext?.getMemoizedToolResult<{
    summary: Array<{ file: string; count: number; examples: Array<{ line: number; text: string }> }>;
    totalMatches: number;
  }>(memoKey, workspaceFingerprint, 3);
  if (memoized) {
    return {
      matches: [],
      summary: memoized.summary,
      totalMatches: memoized.totalMatches,
      capped: false,
      memoized: true as const,
      note: "Reused unchanged grep results from an earlier turn.",
    };
  }

  const regex = new RegExp(pattern, "i");
  const matches: Array<{ file: string; line: number; text: string }> = [];

  walkFiles({
    dir: root,
    cwd,
    maxDepth: 12,
    include,
    operations,
    onFile: (full) => {
      try {
        const content = bufferToUtf8(operations.readFile(full));
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push({
              file: relative(cwd, full),
              line: i + 1,
              text: lines[i].trim().slice(0, 150),
            });
            if (matches.length >= MAX_GREP_MATCHES) return true;
          }
        }
      } catch {
        return false;
      }
      return false;
    },
  });

  const result = {
    matches,
    summary: buildGrepSummary(matches),
    totalMatches: matches.length,
    capped: matches.length >= MAX_GREP_MATCHES,
    details: matches.length >= MAX_GREP_MATCHES ? truncation("matches", matches.length, MAX_GREP_MATCHES) : undefined,
  };
  memoContext?.rememberToolResult(memoKey, workspaceFingerprint, {
    summary: result.summary,
    totalMatches: result.totalMatches,
  });
  return result;
}

export function semSearchDirect({
  query,
  path: dir = ".",
  cwd = process.cwd(),
  include,
  limit,
  operations = localFileOperations,
}: {
  query: string;
  path?: string;
  cwd?: string;
  include?: string;
  limit?: number;
  operations?: SearchOperations;
}) {
  const access = checkFilesystemPathAccess(dir, "read", cwd);
  if (!access.allowed) {
    return {
      results: [],
      totalResults: 0,
      query,
      terms: [],
      error: access.reason,
    };
  }
  const root = access.normalizedPath ?? resolveToCwd(dir, cwd);
  const memoContext = getMemoContext();
  const normalizedQuery = query.trim().toLowerCase();
  const memoKey = ["sem", root, normalizedQuery, include ?? "", limit ?? ""].join("|");
  const workspaceFingerprint = `${memoKey}|v${memoContext?.getWorkspaceVersion() ?? 0}`;
  const memoized = memoContext?.getMemoizedToolResult<{
    results: Array<{ file: string; line: number; excerpt: string; score: number }>;
    totalResults: number;
    terms: string[];
  }>(memoKey, workspaceFingerprint, 3);
  if (memoized) {
    return {
      results: memoized.results,
      totalResults: memoized.totalResults,
      query,
      terms: memoized.terms,
      memoized: true as const,
      note: "Reused unchanged semantic search results from an earlier turn.",
    };
  }
  const tokens = tokenizeSearchQuery(query);
  const maxResults = Math.min(Math.max(limit ?? 6, 1), MAX_SEM_SEARCH_RESULTS);
  const results: Array<{ file: string; line: number; excerpt: string; score: number }> = [];

  walkFiles({
    dir: root,
    cwd,
    maxDepth: 10,
    include,
    operations,
    onFile: (full) => {
      try {
        const raw = bufferToUtf8(operations.readFile(full));
        const content = raw.length > 24000 ? raw.slice(0, 24000) : raw;
        const rel = relative(cwd, full);
        const score = scoreSemanticMatch(normalizedQuery, rel, content, tokens);
        if (score <= 0) return false;
        const match = findFirstMatchLine(content, tokens.length > 0 ? tokens : [normalizedQuery]);
        results.push({
          file: rel,
          line: match?.line ?? 1,
          excerpt: match?.text ?? content.split("\n").find(Boolean)?.trim().slice(0, 180) ?? "",
          score,
        });
      } catch {
        return false;
      }
      return false;
    },
  });

  const ranked = results
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, maxResults);

  const result = {
    results: ranked,
    totalResults: ranked.length,
    query,
    terms: tokens,
    details: results.length > ranked.length ? truncation("results", ranked.length, maxResults, results.length) : undefined,
  };
  memoContext?.rememberToolResult(memoKey, workspaceFingerprint, {
    results: ranked,
    totalResults: ranked.length,
    terms: tokens,
  });
  return result;
}

export async function readFileMaybeRemote(options: ReadFileDirectOptions) {
  const remote = tryParseRemoteGitHubTarget(options.path);
  if (remote?.kind === "file") {
    const network = ensureNetworkAllowed();
    if (!network.allowed) return { success: false as const, error: network.reason };
    return fetchRemoteGitHubFile(remote);
  }
  return readFileDirect(options);
}

export async function listFilesMaybeRemote(options: { path?: string; cwd?: string; maxDepth?: number; include?: string; operations?: ListOperations }) {
  const remote = tryParseRemoteGitHubTarget(options.path ?? ".");
  if (remote) {
    const network = ensureNetworkAllowed();
    if (!network.allowed) return { files: [], totalEntries: 0, truncated: false, error: network.reason };
    return listRemoteGitHubTree(remote);
  }
  return listFilesDirect(options);
}

export function writeFileDirect({ path, cwd = process.cwd(), content, operations = localFileOperations }: { path: string; cwd?: string; content: string; operations?: WriteOperations }) {
  const access = checkFilesystemPathAccess(path, "write", cwd);
  if (!access.allowed) {
    return { success: false as const, error: access.reason ?? "Write not permitted." };
  }
  try {
    const filePath = access.normalizedPath ?? resolveToCwd(path, cwd);
    operations.mkdir(dirname(filePath));
    createCheckpoint();
    operations.writeFile(filePath, content);
    getMemoContext()?.invalidateToolResults();
    return { success: true as const, bytesWritten: content.length };
  } catch (err: unknown) {
    return { success: false as const, error: (err as Error).message };
  }
}

export function editFileDirect({ path, cwd = process.cwd(), old_string, new_string, operations = localFileOperations }: { path: string; cwd?: string; old_string: string; new_string: string; operations?: EditOperations }) {
  const access = checkFilesystemPathAccess(path, "write", cwd);
  if (!access.allowed) {
    return { success: false as const, error: access.reason ?? "Edit not permitted." };
  }
  try {
    const filePath = access.normalizedPath ?? resolveToCwd(path, cwd);
    const content = bufferToUtf8(operations.readFile(filePath));
    const occurrences = content.split(old_string).length - 1;
    if (occurrences === 0) {
      return { success: false as const, error: "old_string not found in file" };
    }
    if (occurrences > 1) {
      return { success: false as const, error: "old_string must match exactly once" };
    }
    createCheckpoint();
    const updated = content.replace(old_string, new_string);
    operations.writeFile(filePath, updated);
    getMemoContext()?.invalidateToolResults();
    return { success: true as const };
  } catch (err: unknown) {
    return { success: false as const, error: (err as Error).message };
  }
}
