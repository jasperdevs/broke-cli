import { chmodSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, resolve, sep } from "path";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_ROOT = resolve(homedir(), ".brokecli");

function isUnderPrivateRoot(path: string): boolean {
  return path === PRIVATE_ROOT || path.startsWith(`${PRIVATE_ROOT}${sep}`);
}

function shouldHardenPermissions(): boolean {
  return process.platform !== "win32";
}

export function ensurePrivateDir(dir: string): void {
  const resolvedDir = resolve(dir);
  if (isUnderPrivateRoot(resolvedDir)) {
    mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  } else {
    mkdirSync(dir, { recursive: true });
  }
  if (!shouldHardenPermissions()) return;
  if (!isUnderPrivateRoot(resolvedDir)) return;
  const dirsToHarden = [resolvedDir];
  if (isUnderPrivateRoot(resolvedDir)) {
    let cursor = dirname(resolvedDir);
    while (isUnderPrivateRoot(cursor)) {
      dirsToHarden.push(cursor);
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  for (const candidate of new Set(dirsToHarden)) {
    if (!existsSync(candidate)) continue;
    try {
      chmodSync(candidate, PRIVATE_DIR_MODE);
    } catch {
      // Best effort only. Some filesystems ignore POSIX mode changes.
    }
  }
}

export function writePrivateTextFile(path: string, content: string): void {
  ensurePrivateDir(dirname(path));
  writeFileSync(path, content, { encoding: "utf-8", mode: PRIVATE_FILE_MODE });
  if (!shouldHardenPermissions()) return;
  try {
    chmodSync(path, PRIVATE_FILE_MODE);
  } catch {
    // Best effort only. Some filesystems ignore POSIX mode changes.
  }
}
