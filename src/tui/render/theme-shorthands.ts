import { RESET } from "../../utils/ansi.js";
import { currentTheme } from "../../core/themes.js";

export { RESET };

export function T(): string { return currentTheme().primary; }
export function OK(): string { return currentTheme().success; }
export const DIM = "\x1b[2m";
