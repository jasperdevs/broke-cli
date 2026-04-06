import { execSync } from "child_process";
import { getSettings } from "../core/config.js";

export interface ValidationResult {
  attempted: boolean;
  failed: boolean;
  report: string;
}

function runValidationCommand(label: string, command: string): string {
  try {
    const output = execSync(command, {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 4,
    });
    const trimmed = output.trim();
    return `${label}: ok${trimmed ? `\n${trimmed.slice(0, 1200)}` : ""}`;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${err.stdout ?? ""}\n${err.stderr ?? err.message ?? ""}`.trim();
    return `${label}: failed\n${output.slice(0, 2000)}`;
  }
}

export function runValidationSuite(afterWrite: boolean): ValidationResult {
  const settings = getSettings();
  if (!afterWrite) return { attempted: false, failed: false, report: "" };

  const reports: string[] = [];
  if (settings.autoLint && settings.lintCommand.trim()) {
    reports.push(runValidationCommand("lint", settings.lintCommand));
  }
  if (settings.autoTest && settings.testCommand.trim()) {
    reports.push(runValidationCommand("test", settings.testCommand));
  }

  if (reports.length === 0) return { attempted: false, failed: false, report: "" };
  const report = reports.join("\n\n");
  return {
    attempted: true,
    failed: /\bfailed\b/i.test(report),
    report,
  };
}
