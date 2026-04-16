import { buildHtmlExport } from "./exports.js";
import { SessionManager } from "../core/session-manager.js";
import { clearRuntimeSettings, setRuntimeSettings } from "../core/config.js";
import { setRuntimeProviderApiKey } from "../core/provider-credentials.js";
import type { UpdateInfo } from "../core/update.js";
import type { ThinkingLevel } from "../core/config-types.js";
import { writePrivateTextFile } from "../core/private-files.js";
import { TOOL_NAMES, type ToolName } from "../tools/registry.js";

type ParsedModelArg = { provider?: string; model?: string; thinking?: string };

interface StartupUpdateApp {
  setUpdateNotice?(notice: UpdateInfo): void;
  setStatus?(message: string): void;
}

type RuntimeProgramOptions = {
  sessionDir?: string;
  session?: boolean;
  verbose?: boolean;
  extensions?: boolean;
  skills?: boolean;
  promptTemplates?: boolean;
  extension?: string[];
  skill?: string[];
  promptTemplate?: string[];
  apiKey?: string;
  provider?: string;
  exportOut?: string;
  tools?: string;
};

export function applyProgramRuntimeSettings(opts: RuntimeProgramOptions, parsedModel: ParsedModelArg, thinkingOverride?: ThinkingLevel): void {
  clearRuntimeSettings();
  if (opts.sessionDir) setRuntimeSettings({ sessionDir: opts.sessionDir });
  if (opts.session === false) setRuntimeSettings({ autoSaveSessions: false });
  if (thinkingOverride) setRuntimeSettings({ thinkingLevel: thinkingOverride, enableThinking: thinkingOverride !== "off" });
  if (opts.verbose) setRuntimeSettings({ quietStartup: false });
  if (opts.extensions === false) setRuntimeSettings({ discoverExtensions: false });
  if (opts.skills === false) setRuntimeSettings({ discoverSkills: false });
  if (opts.promptTemplates === false) setRuntimeSettings({ discoverPrompts: false });
  if (opts.extension?.length) setRuntimeSettings({ extensions: opts.extension });
  if (opts.skill?.length) setRuntimeSettings({ skills: opts.skill });
  if (opts.promptTemplate?.length) setRuntimeSettings({ prompts: opts.promptTemplate });
  if (opts.apiKey) setRuntimeProviderApiKey(parsedModel.provider ?? opts.provider ?? "openai", opts.apiKey);
}

export function applyRuntimeToolSelection(toolsOption: string | undefined, toolsDisabled: boolean): void {
  if (toolsDisabled) {
    setRuntimeSettings({ disabledTools: [...TOOL_NAMES] });
    return;
  }
  if (!toolsOption) return;
  const requested = toolsOption.split(",").map((entry) => entry.trim()).filter(Boolean);
  const allowSet = new Set<string>();
  const denySet = new Set<string>();
  for (const entry of requested) {
    if (entry.startsWith("!") || entry.startsWith("-")) denySet.add(entry.slice(1));
    else allowSet.add(entry.startsWith("+") ? entry.slice(1) : entry);
  }
  const denied = TOOL_NAMES.filter((tool: ToolName) => (allowSet.size > 0 && !allowSet.has(tool)) || denySet.has(tool));
  setRuntimeSettings({ disabledTools: [...new Set<string>(denied)] });
}

export function runExportMode(sessionId: string, sessionDir: string | undefined, exportOut?: string): void {
  const manager = SessionManager.open(sessionId, sessionDir);
  const session = manager.getSession();
  const outputPath = exportOut || `${session.getId()}.html`;
  const content = buildHtmlExport(session.getMessages(), session.getProvider() || "unknown", session.getModel() || "unknown", session.getCwd());
  writePrivateTextFile(outputPath, content);
  process.stdout.write(`${outputPath}\n`);
}

export function reportStartupUpdateNotice(app: StartupUpdateApp, update: UpdateInfo | null): void {
  if (!update) return;
  app.setUpdateNotice?.(update);
  app.setStatus?.(`Update available: v${update.latestVersion}. ${update.command ? "Run /update to install it." : update.instruction}`);
}
