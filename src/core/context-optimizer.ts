import { getSettings } from "./config.js";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function getEvictionThreshold(): number {
  const level = getSettings().cavemanLevel ?? "off";
  if (level === "ultra") return 1;
  if (level === "auto") return 1;
  if (level === "lite") return 4;
  return 6;
}

function compressToolOutputs(content: string): string {
  const level = getSettings().cavemanLevel ?? "off";
  const minLength = level === "ultra" ? 80 : level === "auto" ? 160 : 500;
  if (content.length < minLength) return content;

  let compressed = content
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n");
  const lines = compressed.split("\n");
  const headCount = level === "ultra" ? 1 : level === "auto" ? 2 : 3;
  const tailCount = level === "ultra" ? 1 : level === "auto" ? 1 : 2;
  const maxLines = level === "ultra" ? 6 : level === "auto" ? 10 : 30;
  if (lines.length > maxLines) {
    const head = lines.slice(0, headCount).join("\n");
    const tail = lines.slice(-tailCount).join("\n");
    const omitted = lines.length - headCount - tailCount;
    compressed = `${head}\n[... ${omitted} lines compressed ...]\n${tail}`;
  }

  const maxChars = level === "ultra" ? 180 : level === "auto" ? 420 : 1500;
  if (compressed.length > maxChars) {
    compressed = compressed.slice(0, maxChars) + "\n[compressed]";
  }

  return compressed;
}

function summarizeAttachedFileContexts(content: string): string | null {
  if (!content.includes("--- @")) return null;
  const sections = content.split(/\n{2,}(?=--- @)/);
  if (sections.length < 2) return null;
  const lead = sections[0]?.trim() ?? "";
  const attachments = sections.slice(1)
    .map((section) => {
      const match = section.match(/^--- @([^\n]+) ---\n?/);
      if (!match) return null;
      const body = section.slice(match[0].length);
      const lineCount = body ? body.split("\n").length : 0;
      return `${match[1]} (${lineCount} lines)`;
    })
    .filter((entry): entry is string => !!entry);
  if (attachments.length === 0) return null;
  const summary = `[attached file context omitted from replay] ${attachments.join(", ")}`;
  return lead ? `${lead}\n\n${summary}` : summary;
}

export class ContextOptimizer {
  private readFiles = new Map<string, { turnIndex: number; lineCount: number }>();
  private toolMemo = new Map<string, { fingerprint: string; turnIndex: number; result: unknown }>();
  private currentTurn = 0;

  nextTurn(): number {
    return ++this.currentTurn;
  }

  getCurrentTurn(): number {
    return this.currentTurn;
  }

  reset(): void {
    this.readFiles.clear();
    this.toolMemo.clear();
    this.currentTurn = 0;
  }

  trackFileRead(path: string, lineCount: number): void {
    this.readFiles.set(normalizePath(path), { turnIndex: this.currentTurn, lineCount });
  }

  wasFileRead(path: string): boolean {
    return this.readFiles.has(normalizePath(path));
  }

  getFileReadInfo(path: string): { turnIndex: number; lineCount: number } | undefined {
    return this.readFiles.get(normalizePath(path));
  }

  rememberToolResult(key: string, fingerprint: string, result: unknown): void {
    this.toolMemo.set(key, { fingerprint, turnIndex: this.currentTurn, result });
  }

  getMemoizedToolResult<T>(key: string, fingerprint: string, maxAgeTurns = 2): T | undefined {
    const cached = this.toolMemo.get(key);
    if (!cached || cached.fingerprint !== fingerprint) return undefined;
    if (this.currentTurn - cached.turnIndex > maxAgeTurns) return undefined;
    return cached.result as T;
  }

  invalidateToolResults(): void {
    this.toolMemo.clear();
  }

  optimizeMessages(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const threshold = getEvictionThreshold();
    if (messages.length < threshold * 2) return messages;

    const result: Array<{ role: "user" | "assistant"; content: string }> = [];
    const recentStart = Math.max(0, messages.length - threshold * 2);

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (i < recentStart) {
        const summarizedContext = msg.role === "user" ? summarizeAttachedFileContexts(msg.content) : null;
        result.push({ role: msg.role, content: compressToolOutputs(summarizedContext ?? msg.content) });
      } else {
        result.push(msg);
      }
    }

    return result;
  }
}

export function buildDiffSummary(
  path: string,
  oldStr: string,
  newStr: string,
): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  const parts: string[] = [];
  parts.push(`Edit ${path}: -${oldLines.length} +${newLines.length} lines`);

  for (const l of oldLines.slice(0, 3)) {
    parts.push(`- ${l.slice(0, 80)}`);
  }
  if (oldLines.length > 3) parts.push(`  (${oldLines.length - 3} more removed)`);

  for (const l of newLines.slice(0, 3)) {
    parts.push(`+ ${l.slice(0, 80)}`);
  }
  if (newLines.length > 3) parts.push(`  (${newLines.length - 3} more added)`);

  return parts.join("\n");
}
