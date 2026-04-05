import { readFileSync, existsSync } from "node:fs";
import { parse as parseJsonc } from "jsonc-parser";
import { BrokecliConfigSchema, type BrokecliConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { GLOBAL_CONFIG_FILE } from "../constants.js";
import { findProjectConfig } from "./paths.js";
import { envOverrides } from "./env.js";

function readJsoncFile(path: string): Record<string, unknown> {
  try {
    const content = readFileSync(path, "utf-8");
    return parseJsonc(content) ?? {};
  } catch {
    return {};
  }
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Load config from all sources in priority order:
 * 1. Defaults
 * 2. Global config file (~/.brokecli/config.jsonc)
 * 3. Project config file (.brokecli/config.jsonc, walked up from cwd)
 * 4. Environment variables (BROKECLI_*)
 * 5. CLI flags (passed as overrides)
 */
export async function loadConfig(
  configPath?: string,
  cliOverrides?: Record<string, unknown>,
): Promise<BrokecliConfig> {
  let merged: Record<string, unknown> = { ...DEFAULT_CONFIG };

  // Global config
  if (existsSync(GLOBAL_CONFIG_FILE)) {
    merged = deepMerge(merged, readJsoncFile(GLOBAL_CONFIG_FILE));
  }

  // Project config (walk up from cwd)
  const projectConfig = configPath ?? findProjectConfig();
  if (projectConfig && existsSync(projectConfig)) {
    merged = deepMerge(merged, readJsoncFile(projectConfig));
  }

  // Environment variables
  merged = deepMerge(merged, envOverrides());

  // CLI flag overrides
  if (cliOverrides) {
    merged = deepMerge(merged, cliOverrides);
  }

  // Validate and return
  const result = BrokecliConfigSchema.safeParse(merged);
  if (!result.success) {
    console.error("Config validation errors:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export async function showConfig(configPath?: string): Promise<void> {
  const config = await loadConfig(configPath);
  console.log(JSON.stringify(config, null, 2));
}
