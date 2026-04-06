import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePackageDir(): string {
  let dir = __dirname;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return __dirname;
}

const PACKAGE_DIR = resolvePackageDir();
const PACKAGE_JSON = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf-8")) as {
  name?: string;
  version?: string;
  repository?: { url?: string } | string;
};

function normalizeRepositoryUrl(raw: string | undefined): string {
  if (!raw) return "https://github.com/jasperdevs/brokecli";
  return raw.replace(/^git\+/, "").replace(/\.git$/i, "");
}

const repositoryUrl = typeof PACKAGE_JSON.repository === "string"
  ? PACKAGE_JSON.repository
  : PACKAGE_JSON.repository?.url;

export const PACKAGE_NAME = PACKAGE_JSON.name ?? "@jasperdevs/brokecli";
export const APP_VERSION = PACKAGE_JSON.version ?? "0.0.1";
export const REPOSITORY_URL = normalizeRepositoryUrl(repositoryUrl);
export const RELEASES_URL = `${REPOSITORY_URL}/releases/latest`;
