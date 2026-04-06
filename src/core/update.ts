import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { resolveNativeCommand } from "../ai/native-cli.js";
import { APP_VERSION, PACKAGE_NAME, RELEASES_URL } from "./app-meta.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION_CHECK_TIMEOUT_MS = 4000;

export type InstallMethod = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export interface SelfUpdateCommand {
  command: string;
  args: string[];
  display: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  method: InstallMethod;
  instruction: string;
  releasesUrl: string;
  command?: SelfUpdateCommand;
}

export interface SelfUpdateResult {
  performed: boolean;
  exitCode: number;
  instruction: string;
}

export function compareVersions(left: string, right: string): number {
  const parsePart = (part: string): number => {
    const value = parseInt(part.replace(/[^\d].*$/, ""), 10);
    return Number.isFinite(value) ? value : 0;
  };
  const leftParts = left.split(/[.-]/).map(parsePart);
  const rightParts = right.split(/[.-]/).map(parsePart);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function detectInstallMethod(): InstallMethod {
  const userAgent = (process.env.npm_config_user_agent ?? "").toLowerCase();
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("bun/")) return "bun";
  if (userAgent.startsWith("npm/")) return "npm";

  const resolvedPath = `${__dirname}\0${process.execPath || ""}\0${process.argv[1] || ""}`.toLowerCase();
  if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/") || resolvedPath.includes("\\pnpm\\")) return "pnpm";
  if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/") || resolvedPath.includes("\\yarn\\")) return "yarn";
  if (process.versions.bun) return "bun";
  if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/") || resolvedPath.includes("\\npm\\") || resolvedPath.includes("\\node_modules\\")) return "npm";
  return "unknown";
}

export function buildSelfUpdateCommand(method: InstallMethod, packageName = PACKAGE_NAME): SelfUpdateCommand | undefined {
  switch (method) {
    case "pnpm":
      return { command: "pnpm", args: ["add", "-g", `${packageName}@latest`], display: `pnpm add -g ${packageName}@latest` };
    case "yarn":
      return { command: "yarn", args: ["global", "add", `${packageName}@latest`], display: `yarn global add ${packageName}@latest` };
    case "bun":
      return { command: "bun", args: ["install", "-g", `${packageName}@latest`], display: `bun install -g ${packageName}@latest` };
    case "npm":
      return { command: "npm", args: ["install", "-g", `${packageName}@latest`], display: `npm install -g ${packageName}@latest` };
    default:
      return undefined;
  }
}

export function getSelfUpdateCommand(packageName = PACKAGE_NAME): SelfUpdateCommand | undefined {
  return buildSelfUpdateCommand(detectInstallMethod(), packageName);
}

export function getUpdateInstruction(packageName = PACKAGE_NAME): string {
  const command = getSelfUpdateCommand(packageName);
  return command ? `Run: ${command.display}` : `Download latest: ${RELEASES_URL}`;
}

export async function checkForNewVersion(currentVersion = APP_VERSION, packageName = PACKAGE_NAME): Promise<UpdateInfo | null> {
  if (process.env.BROKECLI_SKIP_VERSION_CHECK || process.env.BROKECLI_OFFLINE) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS);
  try {
    const encodedPackage = packageName.replace("/", "%2f");
    const response = await fetch(`https://registry.npmjs.org/${encodedPackage}/latest`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { version?: string };
    const latestVersion = payload.version?.trim();
    if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) return null;
    const command = getSelfUpdateCommand(packageName);
    return {
      currentVersion,
      latestVersion,
      method: detectInstallMethod(),
      instruction: command ? `Run: ${command.display}` : `Download latest: ${RELEASES_URL}`,
      releasesUrl: RELEASES_URL,
      command,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function runSelfUpdateCommand(command = getSelfUpdateCommand()): SelfUpdateResult {
  if (!command) {
    return {
      performed: false,
      exitCode: 1,
      instruction: getUpdateInstruction(),
    };
  }
  try {
    const executable = resolveNativeCommand(command.command) ?? (process.platform === "win32" && !/\.(exe|cmd|bat)$/i.test(command.command)
      ? `${command.command}.cmd`
      : command.command);
    execFileSync(executable, command.args, {
      stdio: "inherit",
      shell: false,
    });
    return {
      performed: true,
      exitCode: 0,
      instruction: `Run: ${command.display}`,
    };
  } catch (error) {
    const exitCode = typeof (error as { status?: number }).status === "number" ? (error as { status?: number }).status! : 1;
    return {
      performed: true,
      exitCode,
      instruction: `Run: ${command.display}`,
    };
  }
}
