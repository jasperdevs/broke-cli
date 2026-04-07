import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface CommandFilterResult {
  output: string;
  error: string;
  rawPath?: string;
  filtered: boolean;
  executedCommand: string;
}

const RAW_OUTPUT_TEE_THRESHOLD = 6000;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function dedupeLines(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts.entries()].map(([line, count]) => count > 1 ? `${line} (x${count})` : line);
}

function saveRawOutput(command: string, content: string): string | undefined {
  if (!content.trim()) return undefined;
  try {
    const dir = join(homedir(), ".brokecli", "tee");
    mkdirSync(dir, { recursive: true });
    const slug = command
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "command";
    const path = join(dir, `${Date.now()}-${slug}.log`);
    writeFileSync(path, content, "utf-8");
    return path;
  } catch {
    return undefined;
  }
}

function appendRawPath(text: string, rawPath?: string): string {
  if (!rawPath) return text;
  return `${text}${text ? "\n" : ""}[full output: ${rawPath}]`;
}

function summarizeFailureOutput(raw: string, exitCode: number | null): string {
  const interesting = stripAnsi(raw)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => /fail|error|warn|panic|assert|exception|traceback|✖|×|ERR!|FAILED|TS\d+|eslint|vitest|jest|pytest/i.test(line));

  if (interesting.length === 0) {
    const tail = stripAnsi(raw).split("\n").filter(Boolean).slice(-25);
    return tail.join("\n") || `Exit code ${exitCode ?? "unknown"}`;
  }

  return dedupeLines(interesting).slice(0, 40).join("\n");
}

function summarizeSuccessOutput(raw: string): string {
  const lines = stripAnsi(raw).split("\n").map((line) => line.trimEnd()).filter(Boolean);
  const summary = lines.filter((line) => /passed|success|completed|compiled|found 0|ok\b|up to date|done\b/i.test(line));
  if (summary.length > 0) return dedupeLines(summary).slice(0, 20).join("\n");
  return lines.slice(-20).join("\n");
}

function summarizeGrepOutput(raw: string): string | null {
  const lines = stripAnsi(raw).split("\n").filter(Boolean);
  const grouped = new Map<string, Array<{ line: string; text: string }>>();

  for (const entry of lines) {
    const match = entry.match(/^(.+?):(\d+):(.*)$/);
    if (!match) return null;
    const [, file, line, text] = match;
    if (!grouped.has(file)) grouped.set(file, []);
    grouped.get(file)!.push({ line, text: text.trim() });
  }

  const out: string[] = [];
  for (const [file, matches] of grouped) {
    out.push(`${file} (${matches.length})`);
    for (const match of matches.slice(0, 3)) {
      out.push(`  ${match.line}: ${match.text}`);
    }
    if (matches.length > 3) out.push(`  ... ${matches.length - 3} more`);
  }
  return out.join("\n");
}

function shouldSummarizeAsFailures(command: string): boolean {
  return /\b(npm test|pnpm test|yarn test|vitest|jest|pytest|cargo test|go test|tsc|eslint|biome|ruff|next build|npm run build|pnpm build)\b/i.test(command);
}

export function rewriteCommand(command: string): string {
  const trimmed = command.trim();
  if (/^git status$/i.test(trimmed)) return "git status --short --branch";
  if (/^git log$/i.test(trimmed)) return "git log --oneline -n 20";
  return command;
}

export function filterCommandOutput(
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number | null,
): CommandFilterResult {
  const executedCommand = rewriteCommand(command);
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  let output = stdout.trim();
  let error = stderr.trim();
  let filtered = false;

  if (shouldSummarizeAsFailures(executedCommand)) {
    if (exitCode === 0) {
      output = summarizeSuccessOutput(combined);
      error = "";
    } else {
      error = summarizeFailureOutput(combined, exitCode);
      output = "";
    }
    filtered = true;
  } else if (/\b(rg|grep)\b/i.test(executedCommand)) {
    const grepSummary = summarizeGrepOutput(stdout);
    if (grepSummary) {
      output = grepSummary;
      filtered = true;
    }
  }

  let rawPath: string | undefined;
  if (filtered || combined.length > RAW_OUTPUT_TEE_THRESHOLD || exitCode !== 0) {
    rawPath = saveRawOutput(executedCommand, combined);
  }

  if (filtered) {
    output = appendRawPath(output, rawPath);
    error = appendRawPath(error, rawPath);
  } else if (!output && rawPath && exitCode !== 0) {
    error = appendRawPath(error, rawPath);
  }

  return { output, error, rawPath, filtered, executedCommand };
}
