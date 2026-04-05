import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  GLOBAL_CONFIG_FILE,
  GLOBAL_CONFIG_DIR,
  PROJECT_CONFIG_DIR,
  CONFIG_FILE_NAME,
} from "../constants.js";

/**
 * Walk up from cwd to find project-level .brokecli/config.jsonc
 */
export function findProjectConfig(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  const root = resolve("/");

  while (dir !== root) {
    const candidate = join(dir, PROJECT_CONFIG_DIR, CONFIG_FILE_NAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export function showPaths(): void {
  console.log("Config file locations (in priority order):");
  console.log("");
  console.log(`  Global:  ${GLOBAL_CONFIG_FILE}`);
  console.log(`           ${existsSync(GLOBAL_CONFIG_FILE) ? "(exists)" : "(not found)"}`);
  console.log("");

  const projectConfig = findProjectConfig();
  if (projectConfig) {
    console.log(`  Project: ${projectConfig}`);
    console.log("           (exists)");
  } else {
    console.log(`  Project: ./${PROJECT_CONFIG_DIR}/${CONFIG_FILE_NAME}`);
    console.log("           (not found)");
  }

  console.log("");
  console.log(`  Data dir: ${GLOBAL_CONFIG_DIR}`);
}
