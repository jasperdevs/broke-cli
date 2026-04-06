import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

interface TemplateInfo {
  name: string;
  description: string;
  path: string;
}

const GLOBAL_PROMPTS_DIR = join(homedir(), ".brokecli", "prompts");
const LOCAL_PROMPTS_DIR = join(".brokecli", "prompts");

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val;
    }
  }
  return { meta, body: match[2] };
}

function scanDir(dir: string): TemplateInfo[] {
  if (!existsSync(dir)) return [];
  const results: TemplateInfo[] = [];
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const filePath = join(dir, file);
      const name = basename(file, ".md");
      try {
        const raw = readFileSync(filePath, "utf-8");
        const { meta } = parseFrontmatter(raw);
        results.push({
          name: meta.name ?? name,
          description: meta.description ?? "",
          path: filePath,
        });
      } catch {
        results.push({ name, description: "", path: filePath });
      }
    }
  } catch {
    // directory not readable
  }
  return results;
}

export function listTemplates(): TemplateInfo[] {
  const global = scanDir(GLOBAL_PROMPTS_DIR);
  const local = scanDir(LOCAL_PROMPTS_DIR);
  // Local overrides global for same name
  const byName = new Map<string, TemplateInfo>();
  for (const t of global) byName.set(t.name, t);
  for (const t of local) byName.set(t.name, t);
  return [...byName.values()];
}

export function loadTemplate(name: string): string | null {
  const templates = listTemplates();
  const found = templates.find((t) => t.name === name);
  if (!found) return null;
  try {
    const raw = readFileSync(found.path, "utf-8");
    const { body } = parseFrontmatter(raw);
    return body;
  } catch {
    return null;
  }
}
