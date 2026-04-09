import { estimateTextTokens } from "../ai/tokens.js";
import type { Session } from "../core/session.js";

const MAX_TOOL_RESULT_SERIALIZED_CHARS = 6000;

function lineCount(text: string | undefined): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function uniqueFileCount(entries: Array<string | undefined>): number {
  return new Set(entries.filter((entry): entry is string => !!entry)).size;
}

export function estimateToolResultTokens(result: unknown): number {
  try {
    const serialized = JSON.stringify(result);
    if (!serialized) return 0;
    const capped = serialized.length > MAX_TOOL_RESULT_SERIALIZED_CHARS
      ? `${serialized.slice(0, MAX_TOOL_RESULT_SERIALIZED_CHARS)}...`
      : serialized;
    return estimateTextTokens(capped);
  } catch {
    return 0;
  }
}

function inferToolResultDetail(
  session: Session,
  toolName: string,
  result: {
    success?: boolean;
    output?: string;
    error?: string;
    content?: string;
    matches?: unknown[];
    files?: string[];
  },
  toolArgs: Record<string, unknown> | undefined,
): string | undefined {
  if (toolName === "bash") {
    const reroutedTo = (result as any)?.reroutedTo as string | undefined;
    if ((result as any)?.rerouted) session.recordShellRecovery();
    const commandText = typeof toolArgs?.command === "string" ? toolArgs.command : "";
    if (reroutedTo === "readFile") {
      const totalLines = (result as any)?.totalLines;
      const readPath = typeof (result as any)?.path === "string" ? (result as any).path : "";
      if (readPath) session.recordRepoRead(readPath, totalLines ?? 0);
      if (commandText && /\b(test|lint|build|verify|check)\b/i.test(commandText)) {
        session.recordVerification(commandText, result.success === false ? "fail" : "pass", result.error ?? "");
      }
      return totalLines ? `via readFile · ${totalLines} lines` : "via readFile";
    }
    if (reroutedTo === "listFiles") {
      const fileCount = (result as any)?.fileCount;
      session.recordRepoSearch("listFiles", commandText || "list", ((result as any)?.files as string[] | undefined) ?? []);
      if (commandText && /\b(test|lint|build|verify|check)\b/i.test(commandText)) {
        session.recordVerification(commandText, result.success === false ? "fail" : "pass", result.error ?? "");
      }
      return fileCount ? `via listFiles · ${fileCount} files` : "via listFiles";
    }
    if (reroutedTo === "grep") {
      const matchCount = (result as any)?.matchCount;
      session.recordRepoSearch("grep", commandText || "grep", ((result as any)?.matches as Array<{ file: string }> | undefined)?.map((entry) => entry.file) ?? []);
      if (commandText && /\b(test|lint|build|verify|check)\b/i.test(commandText)) {
        session.recordVerification(commandText, result.success === false ? "fail" : "pass", result.error ?? "");
      }
      return matchCount !== undefined ? `via grep · ${matchCount} matches` : "via grep";
    }
    if (commandText && /\b(test|lint|build|verify|check)\b/i.test(commandText)) {
      session.recordVerification(commandText, result.success === false ? "fail" : "pass", result.output?.slice(0, 200) ?? result.error ?? "");
      return result.success === false ? `failed · ${commandText}` : `passed · ${commandText}`;
    }
    if (result.output?.trim()) {
      const firstLine = result.output.trim().split("\n")[0]!;
      return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
    }
    return result.success === false ? "command failed" : "completed";
  }

  if (toolName === "readFile" && result.content) {
    const lineCount = result.content.split("\n").length;
    const readPath = (result as any)?.path ?? "";
    if (readPath) {
      session.getContextOptimizer().trackFileRead(readPath, lineCount);
      session.recordRepoRead(readPath, lineCount);
    }
    const mode = typeof (result as any)?.mode === "string" ? (result as any).mode : "";
    const truncated = (result as any)?.truncated ? " · truncated" : "";
    return `${lineCount} lines${mode ? ` · ${mode}` : ""}${truncated}`;
  }

  if (toolName === "grep" && result.matches) {
    const capped = (result as any)?.capped;
    const files = (result.matches as Array<{ file?: string }>).map((entry) => entry.file);
    session.recordRepoSearch(
      "grep",
      typeof toolArgs?.pattern === "string" ? toolArgs.pattern : "grep",
      files.filter((entry): entry is string => !!entry),
    );
    const fileCount = uniqueFileCount(files);
    return `${result.matches.length} matches in ${fileCount} file${fileCount === 1 ? "" : "s"}${capped ? " · capped" : ""}`;
  }

  if (toolName === "listFiles" && result.files) {
    const totalEntries = (result as any)?.totalEntries;
    const shown = result.files.length;
    session.recordRepoSearch(
      "listFiles",
      typeof toolArgs?.path === "string" ? toolArgs.path : ".",
      result.files.slice(0, 3),
    );
    const base = typeof toolArgs?.path === "string" ? toolArgs.path : ".";
    return totalEntries && totalEntries > shown ? `${shown}/${totalEntries} entries from ${base}` : `${shown} entries from ${base}`;
  }

  if (toolName === "semSearch") {
    const hits = (((result as any)?.results as Array<{ file?: string }> | undefined) ?? [])
      .map((entry) => entry.file)
      .filter((entry): entry is string => !!entry);
    session.recordRepoSearch(
      "semSearch",
      typeof toolArgs?.query === "string" ? toolArgs.query : "semantic",
      hits,
    );
    return `${hits.length} ranked hits`;
  }

  if (toolName === "webSearch") {
    const results = typeof (result as any)?.results === "string" ? (result as any).results : "";
    const backend = typeof (result as any)?.backend === "string" ? ` · ${(result as any).backend}` : "";
    const resultCount = results
      ? results.split(/\n{2,}/).filter((entry: string) => entry.trim()).length
      : 0;
    return `${resultCount || "some"} web result${resultCount === 1 ? "" : "s"}${backend}`;
  }

  if (toolName === "webFetch") {
    const content = typeof result.content === "string" ? result.content : "";
    const contentType = typeof (result as any)?.contentType === "string" && (result as any).contentType
      ? ` · ${(result as any).contentType.split(";")[0]}`
      : "";
    const truncated = (result as any)?.truncated ? " · truncated" : "";
    return `${lineCount(content)} lines fetched${contentType}${truncated}`;
  }

  if (toolName === "writeFile" && result.success !== false) {
    const path = typeof toolArgs?.path === "string" ? toolArgs.path : "";
    if (path) session.recordRepoEdit(path, "write");
    const content = typeof toolArgs?.content === "string" ? toolArgs.content : "";
    const lines = lineCount(content);
    const bytes = typeof (result as any)?.bytesWritten === "number" ? (result as any).bytesWritten : content.length;
    return `${lines} line${lines === 1 ? "" : "s"} · ${bytes} bytes written`;
  }

  if (toolName === "editFile" && result.success !== false) {
    const path = typeof toolArgs?.path === "string" ? toolArgs.path : "";
    if (path) session.recordRepoEdit(path, "edit");
    const oldText = typeof toolArgs?.old_string === "string" ? toolArgs.old_string : "";
    const newText = typeof toolArgs?.new_string === "string" ? toolArgs.new_string : "";
    const oldLines = lineCount(oldText);
    const newLines = lineCount(newText);
    return `${oldLines} -> ${newLines} lines replaced`;
  }

  return undefined;
}

export function observeToolResult(options: {
  session: Session;
  toolName: string;
  result: {
    success?: boolean;
    output?: string;
    error?: string;
    content?: string;
    matches?: unknown[];
    files?: string[];
  };
  toolArgs?: Record<string, unknown>;
}): string | undefined {
  const { session, toolName, result, toolArgs } = options;
  session.recordToolResult(toolName, estimateToolResultTokens(result));
  if (toolName === "bash" && !(result as any)?.rerouted) {
    session.getContextOptimizer().invalidateToolResults();
  }
  return inferToolResultDetail(session, toolName, result, toolArgs);
}
