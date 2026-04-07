import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative } from "path";

/** Recursively collect project files, skipping common noise */
export function collectProjectFiles(root: string, maxFiles = 500): string[] {
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", "coverage", "__pycache__", ".venv", "venv"]);
  const files: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 6 || files.length >= maxFiles) return;
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(".") && entry !== ".env.example") continue;
        if (SKIP.has(entry)) continue;
        const full = join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            walk(full, depth + 1);
          } else if (stat.size < 500_000) {
            files.push(relative(root, full).replace(/\\/g, "/"));
          }
        } catch { /* skip unreadable */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walk(root, 0);
  return files.sort();
}

/** Simple fuzzy match — all chars must appear in order */
export function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastIdx = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += (ti === lastIdx + 1) ? 2 : 1; // consecutive chars score higher
      if (ti === 0 || t[ti - 1] === "/" || t[ti - 1] === "-" || t[ti - 1] === "_") score += 3; // word boundary
      lastIdx = ti;
      qi++;
    }
  }

  return { match: qi === q.length, score };
}

/** Filter and sort files by fuzzy query */
export function filterFiles(files: string[], query: string, limit = 10): string[] {
  if (!query) return files.slice(0, limit);

  const scored = files
    .map((f) => ({ file: f, ...fuzzyMatch(query, f) }))
    .filter((r) => r.match)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((r) => r.file);
}

/** Read file contents (truncated for injection) */
export function readFileForContext(root: string, relPath: string, maxChars = 4000): string {
  try {
    const content = readFileSync(join(root, relPath), "utf-8");
    if (content.length > maxChars) {
      return content.slice(0, maxChars) + `\n... (truncated, ${content.length} chars total)`;
    }
    return content;
  } catch {
    return `(could not read ${relPath})`;
  }
}
