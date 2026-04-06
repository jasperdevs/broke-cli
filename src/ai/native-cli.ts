import { spawnSync } from "child_process";
import { existsSync } from "fs";

function normalizeResolvedCommand(output: string): string | null {
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || null;
}

function normalizeWindowsCommand(path: string): string {
  if (process.platform !== "win32") return path;
  if (/\.(exe|cmd|bat|ps1)$/i.test(path)) return path;
  const candidates = [`${path}.cmd`, `${path}.exe`, `${path}.bat`];
  return candidates.find((candidate) => existsSync(candidate)) ?? path;
}

export function resolveNativeCommand(command: string): string | null {
  const locator = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(locator, [command], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    if (result.error || result.status !== 0) return null;
    const resolved = normalizeResolvedCommand(result.stdout ?? "");
    return resolved ? normalizeWindowsCommand(resolved) : null;
  } catch {
    return null;
  }
}

export function hasNativeCommand(command: string): boolean {
  return !!resolveNativeCommand(command);
}
