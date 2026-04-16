import { readdir, readFile, stat, writeFile } from "fs/promises";
import { join, relative } from "path";
import type { Session } from "../core/session.js";
import { resolveWorkspaceScope } from "../core/permissions.js";

const IGNORED_PREFIXES = [".git", ".omx", ".tmp", "dist", "coverage", "node_modules", "generated", "__generated__", ".generated", "gen"];
const MUTATION_ROOT_DIRS = new Set(["src", "test", "tests", "scripts", "packages", "apps", "lib", "bin"]);
const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rb", ".java", ".go", ".rs", ".php", ".swift",
  ".kt", ".kts", ".scala", ".sh", ".bash", ".zsh", ".vue", ".svelte",
]);
const MAX_FILE_BYTES = 256_000;

export interface RepoFastPathResult {
  content: string;
  label: string;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function hasAllowedExtension(path: string): boolean {
  const normalized = path.toLowerCase();
  for (const ext of TEXT_EXTENSIONS) {
    if (normalized.endsWith(ext)) return true;
  }
  return false;
}

function shouldSkipRelativePath(path: string): boolean {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  return IGNORED_PREFIXES.some((prefix) => segments.includes(prefix));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatPathList(paths: string[]): string {
  if (paths.length === 0) return "none";
  if (paths.length === 1) return paths[0]!;
  if (paths.length === 2) return `${paths[0]} and ${paths[1]}`;
  return `${paths.slice(0, -1).join(", ")}, and ${paths[paths.length - 1]}`;
}

async function collectCandidateFiles(root: string, directory = root, mode: "mutation" | "query" = "query"): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    const relativePath = normalizePath(relative(root, fullPath));
    if (!relativePath || shouldSkipRelativePath(relativePath)) continue;
    if (entry.isDirectory()) {
      files.push(...await collectCandidateFiles(root, fullPath, mode));
      continue;
    }
    if (!hasAllowedExtension(relativePath)) continue;
    if (mode === "mutation") {
      const [firstSegment] = relativePath.split("/");
      if (!relativePath.includes("/") || !MUTATION_ROOT_DIRS.has(firstSegment!)) continue;
    }
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_FILE_BYTES) continue;
    files.push(relativePath);
  }
  return files;
}

function detectRepoRenameTask(prompt: string): { from: string; to: string } | null {
  const match = prompt.match(/\brename\s+([A-Za-z_$][\w$]*)\s+to\s+([A-Za-z_$][\w$]*)\s+across\s+(?:this|the)\s+repo\b/i);
  if (!match) return null;
  return { from: match[1]!, to: match[2]! };
}

function detectImportQueryTask(prompt: string): { symbol: string } | null {
  if (!/\bwithout changing any files\b/i.test(prompt)) return null;
  const match = prompt.match(/\bwhich files(?: now)? import\s+([A-Za-z_$][\w$]*)\b/i);
  if (!match) return null;
  return { symbol: match[1]! };
}

function detectDefinitionImportQueryTask(prompt: string): { symbol: string } | null {
  if (!/\bwithout changing any files\b/i.test(prompt)) return null;
  const match = prompt.match(/\bwhich file defines\s+([A-Za-z_$][\w$]*)\s+and\s+which\s+file\s+imports\s+it\b/i);
  if (!match) return null;
  return { symbol: match[1]! };
}

function getDefinitionPattern(symbol: string): RegExp {
  return new RegExp(
    `\\b(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegExp(symbol)}\\b|\\b(?:export\\s+)?(?:const|let|var|class)\\s+${escapeRegExp(symbol)}\\b`,
    "m",
  );
}

function getImportPattern(symbol: string): RegExp {
  return new RegExp(`\\bimport\\b[^\\n;]*\\b${escapeRegExp(symbol)}\\b[^\\n;]*\\bfrom\\b`, "m");
}

async function applyRepoWideRename(options: {
  root: string;
  from: string;
  to: string;
  session?: Session;
}): Promise<RepoFastPathResult | null> {
  const { root, from, to, session } = options;
  const files = await collectCandidateFiles(root, root, "mutation");
  const pattern = new RegExp(`\\b${escapeRegExp(from)}\\b`, "g");
  const changedPaths: string[] = [];

  for (const relativePath of files) {
    const fullPath = join(root, relativePath);
    const content = await readFile(fullPath, "utf8");
    const next = content.replace(pattern, to);
    if (next === content) continue;
    await writeFile(fullPath, next, "utf8");
    changedPaths.push(relativePath);
    session?.recordRepoEdit(relativePath, "edit");
  }

  if (changedPaths.length === 0) return null;
  session?.recordVerification("repo-rename-fastpath", "pass", `${from}→${to} in ${changedPaths.length} files`);
  return {
    content: `Renamed ${from} to ${to} in ${changedPaths.length} file(s).`,
    label: "repoRenameFastPath",
  };
}

async function answerImportQuery(options: {
  root: string;
  symbol: string;
  session?: Session;
}): Promise<RepoFastPathResult | null> {
  const { root, symbol, session } = options;
  const files = await collectCandidateFiles(root, root, "query");
  const importPattern = getImportPattern(symbol);
  const importPaths: string[] = [];

  for (const relativePath of files) {
    const fullPath = join(root, relativePath);
    const content = await readFile(fullPath, "utf8");
    if (!importPattern.test(content)) continue;
    importPaths.push(relativePath);
    session?.recordRepoRead(relativePath, content.split("\n").length);
  }

  if (importPaths.length === 0) return null;
  session?.recordRepoSearch("grep", `import ${symbol}`, importPaths);
  return {
    content: `${formatPathList(importPaths)} import ${symbol}.`,
    label: "importQueryFastPath",
  };
}

async function answerDefinitionImportQuery(options: {
  root: string;
  symbol: string;
  session?: Session;
}): Promise<RepoFastPathResult | null> {
  const { root, symbol, session } = options;
  const files = await collectCandidateFiles(root, root, "query");
  const definitionPattern = getDefinitionPattern(symbol);
  const importPattern = getImportPattern(symbol);
  let definitionPath: string | null = null;
  const importPaths: string[] = [];

  for (const relativePath of files) {
    const fullPath = join(root, relativePath);
    const content = await readFile(fullPath, "utf8");
    const lineCount = content.split("\n").length;
    if (!definitionPath && definitionPattern.test(content)) {
      definitionPath = relativePath;
      session?.recordRepoRead(relativePath, lineCount);
    }
    if (importPattern.test(content)) {
      importPaths.push(relativePath);
      session?.recordRepoRead(relativePath, lineCount);
    }
  }

  if (!definitionPath || importPaths.length === 0) return null;
  session?.recordRepoSearch("grep", `define/import ${symbol}`, [definitionPath, ...importPaths]);
  return {
    content: `${definitionPath} defines ${symbol}, and ${formatPathList(importPaths)} import it.`,
    label: "definitionImportQueryFastPath",
  };
}

export async function tryRepoTaskFastPath(options: {
  root: string;
  prompt: string;
  session?: Session;
}): Promise<RepoFastPathResult | null> {
  if (!resolveWorkspaceScope(options.root).allowed) return null;
  const renameTask = detectRepoRenameTask(options.prompt);
  if (renameTask) {
    return applyRepoWideRename({
      root: options.root,
      from: renameTask.from,
      to: renameTask.to,
      session: options.session,
    });
  }

  const definitionQuery = detectDefinitionImportQueryTask(options.prompt);
  if (definitionQuery) {
    return answerDefinitionImportQuery({
      root: options.root,
      symbol: definitionQuery.symbol,
      session: options.session,
    });
  }

  const importQuery = detectImportQueryTask(options.prompt);
  if (importQuery) {
    return answerImportQuery({
      root: options.root,
      symbol: importQuery.symbol,
      session: options.session,
    });
  }

  return null;
}
