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

  let compressed = content;
  if (level === "ultra" || level === "auto") {
    compressed = compressed
      .replace(/\r/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n");
  }
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

  if (level === "ultra" || level === "auto") {
    compressed = compressed
      .replace(/\b(directory|directories)\b/gi, "dir")
      .replace(/\b(configuration|configurations)\b/gi, "cfg")
      .replace(/\bimplementation\b/gi, "impl")
      .replace(/\bapplication\b/gi, "app")
      .replace(/\bproject\b/gi, "proj")
      .replace(/\bprovider\b/gi, "prov")
      .replace(/\bcontext\b/gi, "ctx")
      .replace(/\bresponse\b/gi, "res")
      .replace(/\brequest\b/gi, "req")
      .replace(/\bfunction\b/gi, "fn")
      .replace(/\bmessage\b/gi, "msg")
      .replace(/\bincluding\b/gi, "incl")
      .replace(/\bbecause\b/gi, "bc")
      .replace(/\bwithout\b/gi, "w/o")
      .replace(/\bbetween\b/gi, "btwn")
      .replace(/\bresult\b/gi, "res")
      .replace(/\bwarning\b/gi, "warn")
      .replace(/\bfailed\b/gi, "fail")
      .replace(/\bsuccessfully\b/gi, "ok");
  }

  return compressed;
}

export class ContextOptimizer {
  private readFiles = new Map<string, { turnIndex: number; lineCount: number }>();
  private currentTurn = 0;

  nextTurn(): number {
    return ++this.currentTurn;
  }

  getCurrentTurn(): number {
    return this.currentTurn;
  }

  reset(): void {
    this.readFiles.clear();
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
        result.push({ role: msg.role, content: compressToolOutputs(msg.content) });
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
