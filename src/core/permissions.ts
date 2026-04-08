import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve, relative, sep } from "path";
import { getSettings, updateSetting } from "./config.js";
import type { AutonomySettings } from "./config-types.js";

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
  scope?: "workspace" | "trusted-root" | "outside-workspace";
  normalizedPath?: string;
}

const workspaceRootCache = new Map<string, string>();
const DANGEROUS_SHELL_PATTERNS = [
  /\brm\s+-rf\s+(?:\/|\*|~|\\|[a-z]:\\)/i,
  /\bdel\s+\/[a-z]*s/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bhalt\b/i,
  /\bdiskpart\b/i,
  /\breg\s+delete\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fd/i,
];

const PATH_TOKEN = /"([^"]+)"|'([^']+)'|(\.{1,2}[\\/][^\s"'|><;]+|[A-Za-z]:\\[^\s"'|><;]+|\/[^\s"'|><;]+)/g;

export function getAutonomySettings(): AutonomySettings {
  return getSettings().autonomy;
}

export function isToolAllowed(name: string): boolean {
  const disabled = new Set(getSettings().disabledTools ?? []);
  return !disabled.has(name);
}

export function isExtensionEnabled(name: string): boolean {
  return !(getSettings().disabledExtensions ?? []).includes(name);
}

export function toggleExtensionEnabled(name: string): boolean {
  const settings = getSettings();
  const disabled = new Set(settings.disabledExtensions ?? []);
  if (disabled.has(name)) disabled.delete(name);
  else disabled.add(name);
  updateSetting("disabledExtensions", [...disabled].sort());
  return !disabled.has(name);
}

export function getWorkspaceRoot(cwd = process.cwd()): string {
  const normalizedCwd = resolve(cwd);
  const cached = workspaceRootCache.get(normalizedCwd);
  if (cached) return cached;

  let root = normalizedCwd;
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: normalizedCwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && result.stdout.trim()) {
      const candidate = resolve(result.stdout.trim());
      root = existsSync(candidate) ? candidate : normalizedCwd;
    }
  } catch {
    root = normalizedCwd;
  }

  workspaceRootCache.set(normalizedCwd, root);
  return root;
}

function normalizeRootList(roots: string[], cwd = process.cwd()): string[] {
  return [...new Set(
    roots
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => resolve(cwd, entry)),
  )];
}

function isWithinRoot(targetPath: string, root: string): boolean {
  const normalizedTarget = resolve(targetPath);
  const normalizedRoot = resolve(root);
  if (normalizedTarget === normalizedRoot) return true;
  const rel = relative(normalizedRoot, normalizedTarget);
  return !!rel && !rel.startsWith("..") && !rel.includes(`..${sep}`) && !rel.includes("../");
}

function buildTrustedRoots(mode: "read" | "write", cwd = process.cwd()): string[] {
  const settings = getAutonomySettings();
  const workspaceRoot = getWorkspaceRoot(cwd);
  const configured = mode === "read" ? settings.additionalReadRoots : settings.additionalWriteRoots;
  return [workspaceRoot, ...normalizeRootList(configured, cwd)];
}

export function checkFilesystemPathAccess(
  targetPath: string,
  mode: "read" | "write",
  cwd = process.cwd(),
): PermissionDecision {
  const settings = getAutonomySettings();
  const normalizedPath = resolve(cwd, targetPath);
  const trustedRoots = buildTrustedRoots(mode, cwd);

  if (trustedRoots.some((root) => isWithinRoot(normalizedPath, root))) {
    const scope = isWithinRoot(normalizedPath, getWorkspaceRoot(cwd)) ? "workspace" : "trusted-root";
    return { allowed: true, scope, normalizedPath };
  }

  if (mode === "read" && settings.allowReadOutsideWorkspace) {
    return { allowed: true, scope: "outside-workspace", normalizedPath };
  }
  if (mode === "write" && settings.allowWriteOutsideWorkspace) {
    return { allowed: true, scope: "outside-workspace", normalizedPath };
  }

  return {
    allowed: false,
    scope: "outside-workspace",
    normalizedPath,
    reason: mode === "write"
      ? `Blocked write outside the workspace: ${normalizedPath}`
      : `Blocked read outside the workspace: ${normalizedPath}`,
  };
}

export function ensureNetworkAllowed(): PermissionDecision {
  const settings = getAutonomySettings();
  if (settings.allowNetwork) return { allowed: true, scope: "workspace" };
  return {
    allowed: false,
    reason: "Network access is disabled by autonomy settings.",
  };
}

function extractCommandPathCandidates(command: string): string[] {
  const candidates: string[] = [];
  for (const match of command.matchAll(PATH_TOKEN)) {
    const candidate = match[1] ?? match[2] ?? match[3];
    if (!candidate) continue;
    if (/^https?:\/\//i.test(candidate)) continue;
    candidates.push(candidate);
  }
  return [...new Set(candidates)];
}

function commandTouchesWorkspace(command: string): boolean {
  return /\b(cd|ls|dir|cat|type|more|head|tail|find|rg|grep|npm|pnpm|yarn|bun|node|python|pytest|vitest|jest|tsc|eslint|prettier|git|cargo|go|make)\b/i.test(command);
}

export function checkShellCommandAccess(command: string, cwd = process.cwd()): PermissionDecision {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, reason: "Empty shell command." };

  const settings = getAutonomySettings();
  if (!settings.allowDestructiveShell && DANGEROUS_SHELL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { allowed: false, reason: `Blocked dangerous shell command: ${trimmed}` };
  }

  const pathCandidates = extractCommandPathCandidates(trimmed);
  if (pathCandidates.length === 0) {
    return commandTouchesWorkspace(trimmed) || !/[A-Za-z]:\\|\/\w/.test(trimmed)
      ? { allowed: true, scope: "workspace" }
      : { allowed: false, reason: `Blocked shell command with unknown path scope: ${trimmed}` };
  }

  for (const candidate of pathCandidates) {
    const access = checkFilesystemPathAccess(candidate, "read", cwd);
    if (access.allowed) continue;
    if (settings.allowShellOutsideWorkspace) continue;
    return {
      allowed: false,
      reason: `Blocked shell access outside the workspace: ${access.normalizedPath ?? candidate}`,
      normalizedPath: access.normalizedPath,
    };
  }

  return { allowed: true, scope: "workspace" };
}

export function describeAutonomyPolicy(cwd = process.cwd()): string[] {
  const settings = getAutonomySettings();
  const workspaceRoot = getWorkspaceRoot(cwd);
  const readRoots = normalizeRootList(settings.additionalReadRoots, cwd);
  const writeRoots = normalizeRootList(settings.additionalWriteRoots, cwd);
  const lines = [
    `Workspace root: ${workspaceRoot}`,
    "Autonomy rules:",
    "- Workspace reads and writes are allowed by default.",
    settings.allowReadOutsideWorkspace
      ? "- Reads outside the workspace are allowed by config."
      : "- Reads outside the workspace are blocked unless explicitly trusted.",
    settings.allowWriteOutsideWorkspace
      ? "- Writes outside the workspace are allowed by config."
      : "- Writes outside the workspace are blocked unless explicitly trusted.",
    settings.allowShellOutsideWorkspace
      ? "- Shell commands may touch trusted paths outside the workspace."
      : "- Shell commands must stay inside the workspace.",
    settings.allowDestructiveShell
      ? "- Destructive shell operations are enabled by config."
      : "- Destructive shell operations are blocked by default.",
    settings.allowNetwork
      ? "- Network tools are allowed."
      : "- Network tools are disabled.",
  ];
  if (readRoots.length > 0) lines.push(`- Extra read roots: ${readRoots.join(", ")}`);
  if (writeRoots.length > 0) lines.push(`- Extra write roots: ${writeRoots.join(", ")}`);
  return lines;
}
