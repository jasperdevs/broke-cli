import { basename } from "path";
import { getSettings } from "../core/config.js";
import { getActiveToolContext } from "./runtime-context.js";

export type ReadMode = "full" | "minimal" | "aggressive";

const STOP_WORDS = new Set([
  "a", "an", "the", "to", "for", "in", "on", "of", "and", "or", "with", "from", "at", "by",
  "me", "show", "find", "read", "list", "look", "need", "tell", "what", "where", "how", "why",
  "that", "this", "these", "those", "all", "file", "files", "code", "does", "work",
]);

export function getMemoContext() {
  const runtime = getActiveToolContext();
  if (!runtime?.memoizedToolResults || getSettings().memoizeToolResults === false) return null;
  return runtime.contextOptimizer;
}

export function buildReadMemoKey(options: {
  path: string;
  offset?: number;
  limit?: number;
  mode?: ReadMode;
  tail?: number;
}): string {
  return [
    "read",
    options.path,
    options.offset ?? "",
    options.limit ?? "",
    options.mode ?? "full",
    options.tail ?? "",
  ].join("|");
}

export function buildMemoizedReadSummary(path: string, memo: { totalLines: number; mode: ReadMode; firstSeenTurn: number }): string {
  return [
    `[memoized reuse] ${path} is unchanged.`,
    `Exact contents were already returned on turn ${memo.firstSeenTurn} in ${memo.mode} mode (${memo.totalLines} lines).`,
    "Use refresh=true to force the full file contents again.",
  ].join(" ");
}

export function tokenizeSearchQuery(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_.:/-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
  )];
}

export function findFirstMatchLine(content: string, tokens: string[]): { line: number; text: string } | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (tokens.some((token) => lower.includes(token))) {
      return { line: i + 1, text: lines[i].trim().slice(0, 180) };
    }
  }
  return null;
}

export function scoreSemanticMatch(query: string, filePath: string, content: string, tokens: string[]): number {
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
