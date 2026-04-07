import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { basename, join, relative } from "path";
import { assessFileWrite } from "../core/safety.js";
import { createCheckpoint } from "../core/git.js";

/** Max chars to return from file reads (~1500 tokens) */
const MAX_READ_CHARS = 6000;
/** Max lines from grep matches */
const MAX_GREP_MATCHES = 18;
/** Max file entries from listFiles */
const MAX_LIST_FILES = 120;
/** Max semantic search results */
const MAX_SEM_SEARCH_RESULTS = 8;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".omx", ".tmp"]);
const STOP_WORDS = new Set([
  "a", "an", "the", "to", "for", "in", "on", "of", "and", "or", "with", "from", "at", "by",
  "me", "show", "find", "read", "list", "look", "need", "tell", "what", "where", "how", "why",
  "that", "this", "these", "those", "all", "file", "files", "code", "does", "work",
]);

type ReadMode = "full" | "minimal" | "aggressive";

interface ReadFileDirectOptions {
  path: string;
  offset?: number;
  limit?: number;
  mode?: ReadMode;
  tail?: number;
}

interface WalkFileOptions {
  dir: string;
  maxDepth: number;
  include?: string;
  onFile: (fullPath: string) => boolean | void;
}

interface RemoteGitHubTarget {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  kind: "file" | "tree";
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tryParseRemoteGitHubTarget(input: string): RemoteGitHubTarget | null {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "raw.githubusercontent.com" && parts.length >= 4) {
      const [owner, repo, ref, ...rest] = parts;
      return { owner, repo, ref, path: rest.join("/"), kind: "file" };
    }
    if (url.hostname !== "github.com" || parts.length < 2) return null;
    const [owner, repo, section, ref, ...rest] = parts;
    if (!owner || !repo) return null;
    if (section === "blob" && ref && rest.length > 0) {
      return { owner, repo, ref, path: rest.join("/"), kind: "file" };
    }
    if (section === "tree") {
      return { owner, repo, ref: ref || "HEAD", path: rest.join("/"), kind: "tree" };
    }
    return { owner, repo, ref: "HEAD", path: "", kind: "tree" };
  } catch {
    return null;
  }
}

async function fetchRemoteGitHubFile(target: RemoteGitHubTarget) {
  const rawUrl = target.ref === "HEAD"
    ? `https://raw.githubusercontent.com/${target.owner}/${target.repo}/main/${target.path}`
    : `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.ref}/${target.path}`;
  const response = await fetch(rawUrl, {
    headers: {
      "user-agent": "terminal-agent",
      accept: "text/plain,*/*",
    },
  });
  if (!response.ok) {
    return { success: false as const, error: `Remote read failed (${response.status})` };
  }
  const raw = await response.text();
  let content = raw;
  if (content.length > MAX_READ_CHARS) {
    content = content.slice(0, MAX_READ_CHARS);
    return {
      success: true as const,
      content,
      totalLines: raw.split("\n").length,
      truncated: true,
      mode: "full" as const,
      remote: true,
      note: "Remote file truncated.",
      path: `${target.owner}/${target.repo}/${target.path}`,
    };
  }
  return {
    success: true as const,
    content,
    totalLines: raw.split("\n").length,
    mode: "full" as const,
    remote: true,
    path: `${target.owner}/${target.repo}/${target.path}`,
  };
}

async function listRemoteGitHubTree(target: RemoteGitHubTarget) {
  const apiPath = target.path ? `/${target.path}` : "";
  const query = target.ref && target.ref !== "HEAD" ? `?ref=${encodeURIComponent(target.ref)}` : "";
  const response = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}/contents${apiPath}${query}`, {
    headers: {
      "user-agent": "terminal-agent",
      accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    return { success: false as const, error: `Remote list failed (${response.status})` };
  }
  const payload = await response.json();
  const items = Array.isArray(payload) ? payload : [payload];
  const files = items
    .slice(0, MAX_LIST_FILES)
    .map((entry: any) => entry.type === "dir" ? `${entry.name}/` : entry.name);
  return {
    files,
    totalEntries: items.length,
    truncated: items.length > MAX_LIST_FILES,
    remote: true,
    path: `${target.owner}/${target.repo}${target.path ? `/${target.path}` : ""}`,
  };
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

function walkFiles({ dir, maxDepth, include, onFile }: WalkFileOptions): void {
  const visit = (current: string, depth: number): boolean => {
    if (depth > maxDepth) return false;
    try {
      for (const entry of readdirSync(current)) {
        if (entry.startsWith(".") && !entry.startsWith(".env")) continue;
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(current, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          if (visit(full, depth + 1)) return true;
          continue;
        }
        const rel = relative(process.cwd(), full);
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
  return Object.entries(grouped).map(([file, fileMatches]) => ({
    file,
    count: fileMatches.length,
    examples: fileMatches.slice(0, 2),
  }));
}

function tokenizeSearchQuery(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_.:/-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
  )];
}

function findFirstMatchLine(content: string, tokens: string[]): { line: number; text: string } | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (tokens.some((token) => lower.includes(token))) {
      return { line: i + 1, text: lines[i].trim().slice(0, 180) };
    }
  }
  return null;
}

function scoreSemanticMatch(query: string, filePath: string, content: string, tokens: string[]): number {
  const lowerPath = filePath.toLowerCase();
  const lowerBase = basename(filePath).toLowerCase();
  const lowerContent = content.toLowerCase();
  let score = 0;

  if (lowerPath.includes(query)) score += 24;
  if (lowerBase.includes(query)) score += 28;

  for (const token of tokens) {
    if (lowerBase.includes(token)) score += 12;
    if (lowerPath.includes(token)) score += 8;
    const contentHits = lowerContent.split(token).length - 1;
    if (contentHits > 0) score += Math.min(18, contentHits * 3);
  }

  if (/(readme|guide|doc|config|route|render|sidebar|session|budget|tool)/i.test(query) && /(readme|guide|doc|config|route|render|sidebar|session|budget|tool)/i.test(lowerPath)) {
    score += 8;
  }

  return score;
}

export function readFileDirect({ path, offset, limit, mode, tail }: ReadFileDirectOptions) {
  try {
    const raw = readFileSync(path, "utf-8");
    let content = raw;
    const readMode = mode ?? "full";
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
      return {
        success: true as const,
        content,
        totalLines,
        truncated: true,
        mode: readMode,
        note: `File truncated in ${readMode} mode. Use offset/limit to read specific sections.`,
      };
    }

    return { success: true as const, content, totalLines, mode: readMode };
  } catch (err: unknown) {
    return { success: false as const, error: (err as Error).message };
  }
}

export function listFilesDirect({ path: dir = ".", maxDepth, include }: { path?: string; maxDepth?: number; include?: string }) {
  const max = maxDepth ?? 3;
  const files: string[] = [];
  let totalEntries = 0;
  let capped = false;
  const visit = (current: string, depth: number): boolean => {
    if (depth > max) return false;
    try {
      for (const entry of readdirSync(current)) {
        if (entry.startsWith(".") && !entry.startsWith(".env")) continue;
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(current, entry);
        const stat = statSync(full);
        const rel = relative(process.cwd(), full);
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
  visit(dir, 0);
  return { files, totalEntries, truncated: capped };
}

export function grepDirect({ pattern, path: dir = ".", include }: { pattern: string; path?: string; include?: string }) {
  const regex = new RegExp(pattern, "i");
  const matches: Array<{ file: string; line: number; text: string }> = [];

  walkFiles({
    dir,
    maxDepth: 12,
    include,
    onFile: (full) => {
      try {
        const content = readFileSync(full, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push({
              file: relative(process.cwd(), full),
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

  return {
    matches,
    summary: buildGrepSummary(matches),
    totalMatches: matches.length,
    capped: matches.length >= MAX_GREP_MATCHES,
  };
}

export function semSearchDirect({
  query,
  path: dir = ".",
  include,
  limit,
}: {
  query: string;
  path?: string;
  include?: string;
  limit?: number;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = tokenizeSearchQuery(query);
  const maxResults = Math.min(Math.max(limit ?? 6, 1), MAX_SEM_SEARCH_RESULTS);
  const results: Array<{ file: string; line: number; excerpt: string; score: number }> = [];

  walkFiles({
    dir,
    maxDepth: 10,
    include,
    onFile: (full) => {
      try {
        const raw = readFileSync(full, "utf-8");
        const content = raw.length > 24000 ? raw.slice(0, 24000) : raw;
        const rel = relative(process.cwd(), full);
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

  return {
    results: ranked,
    totalResults: ranked.length,
    query,
    terms: tokens,
  };
}

export async function readFileMaybeRemote(options: ReadFileDirectOptions) {
  const remote = tryParseRemoteGitHubTarget(options.path);
  if (remote?.kind === "file") return fetchRemoteGitHubFile(remote);
  return readFileDirect(options);
}

export async function listFilesMaybeRemote(options: { path?: string; maxDepth?: number; include?: string }) {
  const remote = tryParseRemoteGitHubTarget(options.path ?? ".");
  if (remote) return listRemoteGitHubTree(remote);
  return listFilesDirect(options);
}

export function writeFileDirect({ path, content }: { path: string; content: string }) {
  const risk = assessFileWrite(path);
  if (risk.level === "warn") {
    return { success: false as const, error: `Blocked: ${risk.reason}` };
  }
  createCheckpoint();
  try {
    writeFileSync(path, content, "utf-8");
    return { success: true as const, bytesWritten: content.length };
  } catch (err: unknown) {
    return { success: false as const, error: (err as Error).message };
  }
}

export function editFileDirect({ path, old_string, new_string }: { path: string; old_string: string; new_string: string }) {
  createCheckpoint();
  try {
    const content = readFileSync(path, "utf-8");
    if (!content.includes(old_string)) {
      return { success: false as const, error: "old_string not found in file" };
    }
    const updated = content.replace(old_string, new_string);
    writeFileSync(path, updated, "utf-8");
    return { success: true as const };
  } catch (err: unknown) {
    return { success: false as const, error: (err as Error).message };
  }
}
