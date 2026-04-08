import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { homedir } from "os";
import { describePackageResources, resolvePackageRoots } from "./package-manager.js";
import { getSettings, type PackageSource } from "./config.js";
import { isExtensionEnabled } from "./permissions.js";

export interface ExtensionResource {
  id: string;
  path: string;
  enabled: boolean;
  source: string;
}

export interface PromptTemplateResource {
  name: string;
  description: string;
  path: string;
  source: string;
}

export interface SkillResource {
  name: string;
  description: string;
  path: string;
  baseDir: string;
  source: string;
}

const GLOBAL_ROOT = join(homedir(), ".brokecli");
const PROJECT_ROOT = resolve(process.cwd(), ".brokecli");
const GLOBAL_SKILL_ROOT = join(homedir(), ".agents", "skills");
const PROJECT_SKILL_ROOT = resolve(process.cwd(), ".agents", "skills");

function safeReadDir(dir: string): string[] {
  try {
    return existsSync(dir) ? readdirSync(dir) : [];
  } catch {
    return [];
  }
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function walk(dir: string, options?: { recursive?: boolean }): string[] {
  const recursive = options?.recursive ?? false;
  const results: string[] = [];
  for (const entry of safeReadDir(dir)) {
    const path = join(dir, entry);
    const stat = safeStat(path);
    if (!stat) continue;
    if (stat.isDirectory() && recursive) results.push(...walk(path, options));
    else results.push(path);
  }
  return results;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLESTAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLESTAR__/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function applyPatterns(entries: string[], patterns: string[] | undefined): string[] {
  if (patterns === undefined) return entries;
  if (patterns.length === 0) return [];
  const positives = patterns.filter((pattern) => !pattern.startsWith("!") && !pattern.startsWith("-"));
  let selected = positives.length === 0
    ? [...entries]
    : entries.filter((entry) => positives.some((pattern) => {
      const normalized = pattern.startsWith("+") ? pattern.slice(1) : pattern;
      return globToRegExp(normalized).test(entry);
    }));
  const excludes = patterns.filter((pattern) => pattern.startsWith("!") || pattern.startsWith("-"));
  for (const pattern of excludes) {
    const normalized = pattern.slice(1);
    const regex = globToRegExp(normalized);
    selected = selected.filter((entry) => !regex.test(entry));
  }
  return [...new Set(selected)].sort((a, b) => a.localeCompare(b));
}

function resolveConfiguredPath(path: string, baseDir: string): string {
  if (isAbsolute(path)) return path;
  if (path.startsWith("~")) return resolve(homedir(), path.slice(1));
  return resolve(baseDir, path);
}

function packageScans(): Array<{ source: PackageSource; scope: "global" | "project"; root: string }> {
  return resolvePackageRoots().map((entry) => ({
    source: entry.source,
    scope: entry.scope,
    root: entry.root,
  }));
}

function packageSourcePatterns(source: PackageSource, type: "extensions" | "skills" | "prompts"): string[] | undefined {
  return typeof source === "string" ? undefined : source[type];
}

function resolvePackageEntries(type: "extensions" | "skills" | "prompts"): Array<{ dir: string; source: string; patterns?: string[] }> {
  const scans = packageScans();
  const results: Array<{ dir: string; source: string; patterns?: string[] }> = [];
  for (const scan of scans) {
    const manifest = describePackageResources(scan.root);
    const entries = manifest[type];
    const patterns = packageSourcePatterns(scan.source, type);
    for (const entry of entries) {
      const dir = resolve(scan.root, entry);
      if (existsSync(dir)) results.push({ dir, source: typeof scan.source === "string" ? scan.source : scan.source.source, patterns });
    }
  }
  return results;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2] };
}

export function listExtensionResources(): ExtensionResource[] {
  const settings = getSettings();
  const configured = settings.extensions ?? [];
  const bases: Array<{ dir: string; source: string; patterns?: string[] }> = [
    ...(settings.discoverExtensions ? [
      { dir: join(GLOBAL_ROOT, "extensions"), source: "global:extensions" },
      { dir: join(PROJECT_ROOT, "extensions"), source: "project:extensions" },
    ] : []),
    ...configured.map((path) => ({ dir: resolveConfiguredPath(path, PROJECT_ROOT), source: `config:${path}` })),
    ...resolvePackageEntries("extensions"),
  ];
  const results = new Map<string, ExtensionResource>();
  for (const base of bases) {
    const stat = safeStat(base.dir);
    if (!stat) continue;
    const files = stat.isDirectory() ? walk(base.dir, { recursive: false }) : [base.dir];
    const relativeFiles = files
      .filter((file) => [".js", ".mjs", ".cjs"].includes(extname(file).toLowerCase()))
      .map((file) => stat.isDirectory() ? relative(base.dir, file).replace(/\\/g, "/") : basename(file));
    const visible = "patterns" in base ? applyPatterns(relativeFiles, base.patterns) : relativeFiles;
    for (const rel of visible) {
      const filePath = stat.isDirectory() ? join(base.dir, rel) : base.dir;
      const id = basename(filePath).replace(/\.(c|m)?js$/i, "");
      results.set(`${base.source}:${id}`, {
        id,
        path: filePath,
        enabled: isExtensionEnabled(id),
        source: base.source,
      });
    }
  }
  return [...results.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function listPromptTemplates(): PromptTemplateResource[] {
  const settings = getSettings();
  const configured = settings.prompts ?? [];
  const bases: Array<{ dir: string; source: string; patterns?: string[] }> = [
    ...(settings.discoverPrompts ? [
      { dir: join(GLOBAL_ROOT, "prompts"), source: "global:prompts" },
      { dir: join(PROJECT_ROOT, "prompts"), source: "project:prompts" },
    ] : []),
    ...configured.map((path) => ({ dir: resolveConfiguredPath(path, PROJECT_ROOT), source: `config:${path}` })),
    ...resolvePackageEntries("prompts"),
  ];
  const byName = new Map<string, PromptTemplateResource>();
  for (const base of bases) {
    const stat = safeStat(base.dir);
    if (!stat) continue;
    const files = stat.isDirectory() ? walk(base.dir, { recursive: false }) : [base.dir];
    const mdFiles = files.filter((file) => extname(file).toLowerCase() === ".md");
    const relativeFiles = mdFiles.map((file) => stat.isDirectory() ? relative(base.dir, file).replace(/\\/g, "/") : basename(file));
    const visible = "patterns" in base ? applyPatterns(relativeFiles, base.patterns) : relativeFiles;
    for (const rel of visible) {
      const filePath = stat.isDirectory() ? join(base.dir, rel) : base.dir;
      try {
        const raw = readFileSync(filePath, "utf-8");
        const { meta } = parseFrontmatter(raw);
        const name = meta.name ?? basename(filePath, ".md");
        byName.set(name, {
          name,
          description: meta.description ?? "",
          path: filePath,
          source: base.source,
        });
      } catch {
        const name = basename(filePath, ".md");
        byName.set(name, { name, description: "", path: filePath, source: base.source });
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectSkillRoots(baseDir: string): string[] {
  const results: string[] = [];
  for (const entry of safeReadDir(baseDir)) {
    const path = join(baseDir, entry);
    const stat = safeStat(path);
    if (!stat) continue;
    if (stat.isDirectory()) {
      if (existsSync(join(path, "SKILL.md"))) results.push(path);
      results.push(...collectSkillRoots(path));
    }
  }
  return [...new Set(results)];
}

export function listSkills(): SkillResource[] {
  const settings = getSettings();
  const configured = settings.skills ?? [];
  const bases: Array<{ dir: string; source: string; patterns?: string[] }> = [
    ...(settings.discoverSkills ? [
      { dir: join(GLOBAL_ROOT, "skills"), source: "global:skills" },
      { dir: GLOBAL_SKILL_ROOT, source: "global:agents-skills" },
      { dir: join(PROJECT_ROOT, "skills"), source: "project:skills" },
      { dir: PROJECT_SKILL_ROOT, source: "project:agents-skills" },
    ] : []),
    ...configured.map((path) => ({ dir: resolveConfiguredPath(path, PROJECT_ROOT), source: `config:${path}` })),
    ...resolvePackageEntries("skills"),
  ];
  const byName = new Map<string, SkillResource>();
  for (const base of bases) {
    const stat = safeStat(base.dir);
    if (!stat) continue;
    if (stat.isFile() && extname(base.dir).toLowerCase() === ".md") {
      const name = basename(base.dir, ".md");
      byName.set(name, {
        name,
        description: "",
        path: base.dir,
        baseDir: dirname(base.dir),
        source: base.source,
      });
      continue;
    }
    const rootDir = stat.isDirectory() ? base.dir : dirname(base.dir);
    const roots = collectSkillRoots(rootDir);
    const relativeRoots = roots.map((entry) => relative(rootDir, entry).replace(/\\/g, "/"));
    const visible = "patterns" in base ? applyPatterns(relativeRoots, base.patterns) : relativeRoots;
    for (const rel of visible) {
      const skillRoot = join(rootDir, rel);
      const skillPath = join(skillRoot, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const name = basename(skillRoot);
      let description = "";
      try {
        const raw = readFileSync(skillPath, "utf-8");
        description = raw.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#"))?.trim() ?? "";
      } catch {
        // ignore
      }
      byName.set(name, {
        name,
        description,
        path: skillPath,
        baseDir: skillRoot,
        source: base.source,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadPromptTemplate(name: string): string | null {
  const template = listPromptTemplates().find((entry) => entry.name === name);
  if (!template) return null;
  try {
    return parseFrontmatter(readFileSync(template.path, "utf-8")).body;
  } catch {
    return null;
  }
}

export function loadSkill(name: string): SkillResource | null {
  return listSkills().find((entry) => entry.name === name) ?? null;
}
