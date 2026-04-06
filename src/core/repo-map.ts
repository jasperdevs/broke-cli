import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative } from "path";

export interface RepoMapOptions {
  root?: string;
  maxFiles?: number;
  maxLinesPerFile?: number;
  query?: string;
}

export interface RepoMapEntry {
  path: string;
  lines: string[];
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".omx",
  ".tmp",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".kt", ".rb", ".php",
  ".cpp", ".cc", ".c", ".h", ".hpp", ".cs", ".swift",
  ".scala", ".sh", ".zsh", ".md",
]);

const SYMBOL_PATTERNS: RegExp[] = [
  /^\s*export\s+(async\s+)?function\s+\w+/,
  /^\s*(async\s+)?function\s+\w+/,
  /^\s*export\s+class\s+\w+/,
  /^\s*class\s+\w+/,
  /^\s*export\s+(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/,
  /^\s*(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/,
  /^\s*export\s+interface\s+\w+/,
  /^\s*export\s+type\s+\w+/,
  /^\s*def\s+\w+/,
  /^\s*class\s+\w+/,
  /^\s*fn\s+\w+/,
  /^\s*impl\s+\w+/,
];

function walkFiles(root: string, files: string[], maxFiles: number): void {
  if (files.length >= maxFiles) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    if (entry.startsWith(".") && entry !== ".brokecli") continue;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkFiles(full, files, maxFiles);
      continue;
    }
    if (!CODE_EXTENSIONS.has(extname(entry).toLowerCase())) continue;
    files.push(full);
  }
}

function scoreFile(path: string, query: string): number {
  if (!query) return 0;
  const lower = path.toLowerCase();
  let score = 0;
  for (const term of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (lower.includes(term)) score += 20;
  }
  return score;
}

function extractInterestingLines(path: string, maxLines: number, query: string): string[] {
  let raw = "";
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  const matches: Array<{ score: number; text: string }> = [];
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    let score = 0;
    if (SYMBOL_PATTERNS.some((pattern) => pattern.test(line))) score += 50;
    if (i < 20) score += 5;
    for (const term of queryTerms) {
      if (trimmed.toLowerCase().includes(term)) score += 25;
    }
    if (score <= 0) continue;
    matches.push({ score, text: `${i + 1}: ${trimmed}` });
  }

  matches.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
  return matches.slice(0, maxLines).map((entry) => entry.text);
}

export function buildRepoMap(options: RepoMapOptions = {}): RepoMapEntry[] {
  const root = options.root ?? process.cwd();
  const maxFiles = options.maxFiles ?? 40;
  const maxLinesPerFile = options.maxLinesPerFile ?? 8;
  const query = options.query?.trim() ?? "";
  const files: string[] = [];
  walkFiles(root, files, maxFiles * 3);

  const ranked = files
    .map((path) => ({ path, score: scoreFile(path, query) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, maxFiles);

  return ranked
    .map(({ path }) => {
      const lines = extractInterestingLines(path, maxLinesPerFile, query);
      if (lines.length === 0) return null;
      return {
        path: relative(root, path),
        lines,
      };
    })
    .filter((entry): entry is RepoMapEntry => entry !== null);
}

export function formatRepoMap(entries: RepoMapEntry[]): string {
  return entries
    .map((entry) => [`## ${entry.path}`, ...entry.lines].join("\n"))
    .join("\n\n");
}
