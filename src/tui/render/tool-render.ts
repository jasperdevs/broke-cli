export function compactPreview(text: string, maxLength = 88): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function shortenDisplayPath(text: string): string {
  const normalized = text.trim();
  if (!normalized) return normalized;
  const windowsLike = /^[a-z]:\\/i.test(normalized);
  const unixLike = normalized.startsWith("/");
  if (!windowsLike && !unixLike) return normalized;
  const cwd = process.cwd().replace(/\//g, "\\");
  const comparable = normalized.replace(/\//g, "\\");
  if (comparable.toLowerCase().startsWith(`${cwd.toLowerCase()}\\`)) {
    return comparable.slice(cwd.length + 1).replace(/\\/g, "/");
  }
  const parts = comparable.split(/\\+/).filter(Boolean);
  const tail = parts.slice(-2).join("/");
  return tail || comparable;
}

export function wrapVisibleText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const parts = text.split(/([ \t]+|[\\/._:-]+)/);
  const lines: string[] = [];
  let current = "";

  for (const part of parts) {
    if (!part) continue;
    if (current.length + part.length <= width) {
      current += part;
      continue;
    }
    if (current.trim().length > 0) {
      lines.push(current.trimEnd());
      current = /^[ \t]+$/.test(part) ? "" : part.trimStart();
      continue;
    }
    lines.push(part.slice(0, width));
    current = part.slice(width);
  }

  if (current.length > 0) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [""];
}

export function renderPrefixedWrappedLines(prefix: string, text: string, width: number): string[] {
  const available = Math.max(8, width - prefix.length);
  return wrapVisibleText(text, available).map((line) => `${prefix}${line}`);
}

function lineCount(text: string | undefined): number {
  if (!text) return 0;
  return text.split("\n").length;
}

export function toolArgumentSummary(tc: { name: string; preview: string; args?: unknown; streamOutput?: string }): string | null {
  const args = tc.args as Record<string, unknown> | undefined;
  if (!args) return null;
  switch (tc.name) {
    case "readFile":
    case "Read": {
      const tail = typeof args.tail === "number" ? args.tail : null;
      const offset = typeof args.offset === "number" ? args.offset : null;
      const limit = typeof args.limit === "number" ? args.limit : null;
      const mode = typeof args.mode === "string" ? args.mode : null;
      const parts: string[] = [];
      if (tail) parts.push(`last ${tail} lines`);
      else if (offset !== null || limit !== null) {
        const start = (offset ?? 0) + 1;
        const end = limit !== null ? start + limit - 1 : null;
        parts.push(`lines ${start}${end ? `-${end}` : ""}`);
      }
      if (mode && mode !== "full") parts.push(mode);
      return parts.join(" · ") || null;
    }
    case "writeFile":
    case "Write": {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content) return null;
      return `${lineCount(content)} line${lineCount(content) === 1 ? "" : "s"} · ${content.length} bytes`;
    }
    case "editFile":
    case "Edit": {
      const firstEdit = Array.isArray(args.edits) ? args.edits[0] as Record<string, unknown> | undefined : undefined;
      const oldText = typeof args.old_string === "string" ? args.old_string : typeof firstEdit?.oldText === "string" ? firstEdit.oldText : "";
      const newText = typeof args.new_string === "string" ? args.new_string : typeof firstEdit?.newText === "string" ? firstEdit.newText : "";
      if (!oldText && !newText) return null;
      const count = Array.isArray(args.edits) ? args.edits.length : 1;
      return `${count} edit${count === 1 ? "" : "s"} · ${lineCount(oldText)} -> ${lineCount(newText)} lines`;
    }
    case "listFiles":
    case "LS": {
      const include = typeof args.include === "string" ? args.include : "";
      const maxDepth = typeof args.maxDepth === "number" ? args.maxDepth : null;
      const parts: string[] = [];
      if (maxDepth !== null) parts.push(`depth ${maxDepth}`);
      if (include) parts.push(include);
      return parts.join(" · ") || null;
    }
    case "grep": {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      return pattern ? `pattern: ${compactPreview(pattern, 72)}` : null;
    }
    case "semSearch": {
      const query = typeof args.query === "string" ? args.query : "";
      return query ? compactPreview(query, 72) : null;
    }
    case "webSearch": {
      const query = typeof args.query === "string" ? args.query : "";
      return query ? `query: ${compactPreview(query, 72)}` : null;
    }
    case "webFetch": {
      const format = typeof args.format === "string" ? args.format : "";
      const timeout = typeof args.timeout === "number" ? args.timeout : null;
      const parts: string[] = [];
      if (format) parts.push(format);
      if (timeout !== null) parts.push(`${timeout}s timeout`);
      return parts.join(" · ") || null;
    }
    case "glob":
    case "Glob": {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      return pattern ? `pattern: ${compactPreview(pattern, 72)}` : null;
    }
    case "bash": {
      const command = typeof args.command === "string" ? args.command : "";
      if (!command) return null;
      return tc.preview !== command ? command : null;
    }
    default:
      return null;
  }
}

export function toolDescription(tc: { name: string; preview: string }): string {
  const preview = shortenDisplayPath(tc.preview);
  switch (tc.name) {
    case "bash":
      return `run ${compactPreview(preview, 60)}`;
    case "Read":
    case "readFile":
      return `read ${preview}`.trim();
    case "Write":
    case "writeFile":
      return `write ${preview}`.trim();
    case "Edit":
    case "editFile":
      return `edit ${preview}`.trim();
    case "workspaceEdit":
      return `changed ${preview}`.trim();
    case "Glob":
    case "glob":
      return `find ${preview}`.trim();
    case "LS":
    case "listFiles":
      return `list ${preview}`.trim();
    case "grep":
      return `grep ${preview}`.trim();
    case "semSearch":
      return `search ${preview}`.trim();
    case "webSearch":
      return `web search ${compactPreview(preview, 60)}`.trim();
    case "webFetch":
      return `fetch ${compactPreview(preview, 60)}`.trim();
    case "todoWrite":
      return `update tasks`;
    default:
      return preview && preview !== "..." ? `${tc.name} ${compactPreview(preview, 60)}` : tc.name;
  }
}
