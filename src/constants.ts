import { homedir } from "node:os";
import { join } from "node:path";

export const APP_NAME = "brokecli";
export const CONFIG_DIR_NAME = ".brokecli";
export const CONFIG_FILE_NAME = "config.jsonc";

export const GLOBAL_CONFIG_DIR = join(homedir(), CONFIG_DIR_NAME);
export const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, CONFIG_FILE_NAME);
export const PROJECT_CONFIG_DIR = CONFIG_DIR_NAME;
export const PROJECT_CONFIG_FILE = join(PROJECT_CONFIG_DIR, CONFIG_FILE_NAME);
