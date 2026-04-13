import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, isAbsolute, join, resolve } from "path";
import { homedir } from "os";
import { getGlobalConfigPath, getProjectConfigPath, loadGlobalConfig, loadProjectConfig, type PackageFilterSource, type PackageSource, updateSettingsPatch } from "./config.js";

export interface InstalledPackageInfo {
  scope: "global" | "project";
  source: string;
  root: string;
  kind: "npm" | "git" | "url" | "path";
  pinned: boolean;
  installed: boolean;
}

function getAgentDir(scope: "global" | "project"): string {
  return scope === "global" ? join(homedir(), ".brokecli") : resolve(process.cwd(), ".brokecli");
}

function getPackagesDir(scope: "global" | "project", kind: "npm" | "git"): string {
  return join(getAgentDir(scope), kind);
}

function getSettingsBaseDir(scope: "global" | "project"): string {
  return scope === "global" ? join(homedir(), ".brokecli") : resolve(process.cwd(), ".brokecli");
}

function sanitizeSlug(input: string): string {
  return input.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function toPackageSourceString(source: PackageSource): string {
  return typeof source === "string" ? source : source.source;
}

function parseSource(source: string): { kind: InstalledPackageInfo["kind"]; spec: string; ref?: string; pinned: boolean; npmName?: string } {
  if (source.startsWith("npm:")) {
    const spec = source.slice(4);
    const atIndex = spec.lastIndexOf("@");
    const pinned = atIndex > 0;
    const npmName = pinned ? spec.slice(0, atIndex) : spec;
    return { kind: "npm", spec, pinned, npmName };
  }
  if (source.startsWith("git:")) {
    const spec = source.slice(4);
    const atIndex = spec.lastIndexOf("@");
    return {
      kind: "git",
      spec: pinnedGitBase(spec),
      ref: atIndex > 0 ? spec.slice(atIndex + 1) : undefined,
      pinned: atIndex > 0,
    };
  }
  if (/^https?:\/\//i.test(source) || /^ssh:\/\//i.test(source) || /^git:\/\//i.test(source)) {
    const atIndex = source.lastIndexOf("@");
    return {
      kind: "url",
      spec: atIndex > "https://".length ? source.slice(0, atIndex) : source,
      ref: atIndex > "https://".length ? source.slice(atIndex + 1) : undefined,
      pinned: atIndex > "https://".length,
    };
  }
  return { kind: "path", spec: source, pinned: true };
}

function pinnedGitBase(spec: string): string {
  const atIndex = spec.lastIndexOf("@");
  return atIndex > 0 ? spec.slice(0, atIndex) : spec;
}

function resolveLocalPath(source: string, scope: "global" | "project"): string {
  return isAbsolute(source) ? source : resolve(getSettingsBaseDir(scope), source);
}

function managedPackageRoot(source: string, scope: "global" | "project"): string {
  const parsed = parseSource(source);
  if (parsed.kind === "npm") return join(getPackagesDir(scope, "npm"), sanitizeSlug(parsed.spec));
  if (parsed.kind === "git" || parsed.kind === "url") return join(getPackagesDir(scope, "git"), sanitizeSlug(parsed.spec));
  return resolveLocalPath(source, scope);
}

function packageInstallRoot(source: string, scope: "global" | "project"): string {
  const parsed = parseSource(source);
  const managedRoot = managedPackageRoot(source, scope);
  if (parsed.kind === "npm") {
    const npmName = parsed.npmName ?? parsed.spec;
    return join(managedRoot, "node_modules", npmName);
  }
  return managedRoot;
}

function configuredPackages(scope: "global" | "project"): PackageSource[] {
  const config = scope === "global" ? loadGlobalConfig() : loadProjectConfig();
  return [...(config.settings?.packages ?? [])];
}

function savePackages(packages: PackageSource[], scope: "global" | "project"): void {
  updateSettingsPatch({ packages }, scope);
}

function runCommand(command: string[], cwd?: string): void {
  execFileSync(command[0], command.slice(1), {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
    shell: false,
  });
}

function getNpmCommand(): string[] {
  const configured = loadGlobalConfig().settings?.npmCommand ?? [];
  return configured.length > 0 ? configured : ["npm"];
}

function ensurePackageParent(source: string, scope: "global" | "project"): void {
  const parsed = parseSource(source);
  if (parsed.kind === "path") return;
  mkdirSync(parsed.kind === "npm" ? getPackagesDir(scope, "npm") : getPackagesDir(scope, "git"), { recursive: true });
}

function ensurePackageRoot(source: string, scope: "global" | "project"): string {
  ensurePackageParent(source, scope);
  const root = managedPackageRoot(source, scope);
  mkdirSync(root, { recursive: true });
  return root;
}

function installNpmPackage(source: string, scope: "global" | "project"): void {
  const root = ensurePackageRoot(source, scope);
  const npmCommand = getNpmCommand();
  const packageJsonPath = join(root, "package.json");
  if (!existsSync(packageJsonPath)) writeFileSync(packageJsonPath, JSON.stringify({ private: true, name: "brokecli-package-host" }, null, 2), "utf-8");
  runCommand([...npmCommand, "install", "--no-package-lock", "--no-save", source.slice(4)], root);
}

function installGitPackage(source: string, scope: "global" | "project"): void {
  const parsed = parseSource(source);
  const root = managedPackageRoot(source, scope);
  if (existsSync(join(root, ".git"))) {
    runCommand(["git", "-C", root, "fetch", "--all", "--tags"]);
  } else {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, ".."), { recursive: true });
    runCommand(["git", "clone", parsed.spec, root]);
  }
  if (parsed.ref) runCommand(["git", "-C", root, "checkout", parsed.ref]);
  else runCommand(["git", "-C", root, "pull", "--ff-only"], root);
  if (existsSync(join(root, "package.json"))) {
    const npmCommand = getNpmCommand();
    runCommand([...npmCommand, "install", "--no-package-lock"], root);
  }
}

function withSourceObject(source: PackageSource): PackageFilterSource {
  return typeof source === "string" ? { source } : { ...source };
}

export function listInstalledPackages(): InstalledPackageInfo[] {
  const entries: InstalledPackageInfo[] = [];
  for (const scope of ["project", "global"] as const) {
    for (const pkg of configuredPackages(scope)) {
      const source = toPackageSourceString(pkg);
      const parsed = parseSource(source);
      const root = packageInstallRoot(source, scope);
      entries.push({
        scope,
        source,
        root,
        kind: parsed.kind,
        pinned: parsed.pinned,
        installed: existsSync(root),
      });
    }
  }
  return entries;
}

export async function ensureConfiguredPackagesInstalled(): Promise<InstalledPackageInfo[]> {
  const missing = listInstalledPackages().filter((entry) => !entry.installed);
  for (const entry of missing) {
    await installPackage(entry.source, { local: entry.scope === "project" });
  }
  return missing;
}

export function resolvePackageRoots(): Array<{ scope: "global" | "project"; source: PackageSource; root: string }> {
  const bySource = new Map<string, { scope: "global" | "project"; source: PackageSource; root: string }>();
  for (const scope of ["global", "project"] as const) {
    for (const source of configuredPackages(scope)) {
      const key = toPackageSourceString(source);
      bySource.set(key, {
        scope,
        source,
        root: packageInstallRoot(key, scope),
      });
    }
  }
  return [...bySource.values()].filter((entry) => existsSync(entry.root));
}

export async function installPackage(source: string, options?: { local?: boolean }): Promise<void> {
  const scope = options?.local ? "project" : "global";
  const parsed = parseSource(source);
  if (parsed.kind === "npm") installNpmPackage(source, scope);
  else if (parsed.kind === "git" || parsed.kind === "url") installGitPackage(source, scope);
  else if (!existsSync(resolveLocalPath(source, scope))) throw new Error(`Path not found: ${source}`);

  const packages = configuredPackages(scope);
  if (!packages.some((entry) => toPackageSourceString(entry) === source)) {
    savePackages([...packages, source], scope);
  }
}

export async function removePackage(source: string, options?: { local?: boolean }): Promise<void> {
  const scope = options?.local ? "project" : "global";
  const packages = configuredPackages(scope).filter((entry) => toPackageSourceString(entry) !== source);
  savePackages(packages, scope);
  const parsed = parseSource(source);
  if (parsed.kind !== "path") rmSync(managedPackageRoot(source, scope), { recursive: true, force: true });
}

export async function updatePackages(source?: string, options?: { scope?: "global" | "project" }): Promise<void> {
  const targets = listInstalledPackages()
    .filter((entry) => !source || entry.source === source)
    .filter((entry) => !options?.scope || entry.scope === options.scope)
    .filter((entry) => !entry.pinned);
  for (const entry of targets) {
    if (entry.kind === "npm") installNpmPackage(entry.source, entry.scope);
    else if (entry.kind === "git" || entry.kind === "url") installGitPackage(entry.source, entry.scope);
  }
}

export function setPackageResourceConfig(
  source: string,
  type: "extensions" | "skills" | "prompts" | "themes",
  patterns: string[],
  scope: "global" | "project" = "global",
): void {
  const packages = configuredPackages(scope);
  const next = packages.map((entry) => {
    if (toPackageSourceString(entry) !== source) return entry;
    const normalized = withSourceObject(entry);
    normalized[type] = patterns;
    return normalized;
  });
  savePackages(next, scope);
}

export function describePackageResources(root: string): { extensions: string[]; skills: string[]; prompts: string[]; themes: string[] } {
  const packageJsonPath = join(root, "package.json");
  const defaults = {
    extensions: existsSync(join(root, "extensions")) ? ["extensions"] : [],
    skills: existsSync(join(root, "skills")) ? ["skills"] : [],
    prompts: existsSync(join(root, "prompts")) ? ["prompts"] : [],
    themes: existsSync(join(root, "themes")) ? ["themes"] : [],
  };
  if (!existsSync(packageJsonPath)) return defaults;
  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const manifest = raw.pi ?? {};
    return {
      extensions: normalizeManifestEntries(manifest.extensions, defaults.extensions),
      skills: normalizeManifestEntries(manifest.skills, defaults.skills),
      prompts: normalizeManifestEntries(manifest.prompts, defaults.prompts),
      themes: normalizeManifestEntries(manifest.themes, defaults.themes),
    };
  } catch {
    return defaults;
  }
}

function normalizeManifestEntries(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") return [value];
  return fallback;
}

export function resolvePathSourceRoot(source: string, scope: "global" | "project"): string {
  const parsed = parseSource(source);
  if (parsed.kind !== "path") return packageInstallRoot(source, scope);
  return resolveLocalPath(source, scope);
}

export function listPackageSources(scope?: "global" | "project"): Array<{ scope: "global" | "project"; source: PackageSource }> {
  const scopes = scope ? [scope] : ["global", "project"] as const;
  return scopes.flatMap((entryScope) => configuredPackages(entryScope).map((source) => ({ scope: entryScope, source })));
}

export function getPackageConfigPaths(): { global: string; project: string } {
  return {
    global: getGlobalConfigPath(),
    project: getProjectConfigPath(),
  };
}

export function guessPackageLabel(source: string): string {
  const parsed = parseSource(source);
  if (parsed.kind === "npm") return parsed.npmName ?? parsed.spec;
  if (parsed.kind === "path") return basename(resolveLocalPath(source, "project"));
  return basename(parsed.spec).replace(/\.git$/i, "") || source;
}
