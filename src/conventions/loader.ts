import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

/** Convention file names to look for, in priority order */
const CONVENTION_FILES = [
  "RULES.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".brokecli/rules.md",
];

/**
 * Walk up from cwd to root, collecting convention file contents.
 * Files closer to cwd take precedence (loaded last = appended last).
 */
export function loadConventions(from: string = process.cwd()): string {
  const parts: string[] = [];
  let dir = resolve(from);
  const root = resolve("/");

  while (dir !== root) {
    for (const file of CONVENTION_FILES) {
      const candidate = join(dir, file);
      if (existsSync(candidate)) {
        try {
          const content = readFileSync(candidate, "utf-8").trim();
          if (content) {
            parts.push(`<!-- from ${candidate} -->\n${content}`);
          }
        } catch {
          // skip unreadable files
        }
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return parts.join("\n\n");
}
