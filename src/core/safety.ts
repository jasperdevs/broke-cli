const DANGEROUS_COMMANDS = [
  /\brm\s+-rf?\s/i,
  /\brm\s+-r\s/i,
  /\brmdir\s/i,
  /\bdel\s+\/s/i,
  /\bformat\s/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bgit\s+push\s+--force/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-[fd]/i,
  /\bchmod\s+777/i,
  /\bcurl\b.*\|\s*(ba)?sh/i,
  /\bwget\b.*\|\s*(ba)?sh/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bnpm\s+publish/i,
  /\bdocker\s+rm/i,
  /\bkill\s+-9/i,
  /\bsudo\s/i,
];

const SENSITIVE_PATHS = [
  /\.env$/i,
  /\.env\./i,
  /credentials/i,
  /secret/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.ssh\//i,
];

import { getSettings } from "./config.js";

export type RiskLevel = "safe" | "warn" | "dangerous";

export function assessCommand(command: string): { level: RiskLevel; reason?: string } {
  if (getSettings().yoloMode) return { level: "safe" };
  for (const pattern of DANGEROUS_COMMANDS) {
    if (pattern.test(command)) {
      return { level: "dangerous", reason: `Blocked: ${command.slice(0, 60)}` };
    }
  }
  return { level: "safe" };
}

export function assessFileWrite(path: string): { level: RiskLevel; reason?: string } {
  if (getSettings().yoloMode) return { level: "safe" };
  for (const pattern of SENSITIVE_PATHS) {
    if (pattern.test(path)) {
      return { level: "warn", reason: `Writing to sensitive path: ${path}` };
    }
  }
  return { level: "safe" };
}
