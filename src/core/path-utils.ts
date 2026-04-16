import { accessSync, constants } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

function fileExists(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function expandPath(path: string): string {
  const normalized = path.replace(UNICODE_SPACES, " ").replace(/^@/, "");
  if (normalized === "~") return homedir();
  if (normalized.startsWith("~/") || normalized.startsWith("~\\")) return homedir() + normalized.slice(1);
  return normalized;
}

export function resolveToCwd(path: string, cwd: string): string {
  const expanded = expandPath(path);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export function resolveReadPath(path: string, cwd: string): string {
  const resolved = resolveToCwd(path, cwd);
  if (fileExists(resolved)) return resolved;
  const amPmVariant = resolved.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
  if (amPmVariant !== resolved && fileExists(amPmVariant)) return amPmVariant;
  const nfdVariant = resolved.normalize("NFD");
  if (nfdVariant !== resolved && fileExists(nfdVariant)) return nfdVariant;
  const curlyVariant = resolved.replace(/'/g, "\u2019");
  if (curlyVariant !== resolved && fileExists(curlyVariant)) return curlyVariant;
  const nfdCurlyVariant = nfdVariant.replace(/'/g, "\u2019");
  if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) return nfdCurlyVariant;
  return resolved;
}
