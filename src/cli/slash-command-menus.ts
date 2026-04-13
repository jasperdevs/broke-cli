import { execSync } from "child_process";
import { buildSystemPrompt, reloadContext } from "../core/context.js";
import { clearCredentials, hasStoredCredentials, listAuthenticated } from "../core/auth.js";
import { getSettings, loadConfig, updateProviderConfig, updateSetting, type AutonomySettings, type Mode, type Settings } from "../core/config.js";
import { getProviderCredential } from "../core/provider-credentials.js";
import { listProjects } from "../core/projects.js";
import { listExtensions } from "../core/extensions.js";
import { describePackageResources, installPackage, listInstalledPackages } from "../core/package-manager.js";
import { searchPackageRegistry } from "../core/package-search.js";
import { toggleExtensionEnabled } from "../core/permissions.js";
import { Session } from "../core/session.js";
import type { Keypress } from "../utils/keypress-types.js";
import { buildHtmlExport, buildMarkdownExport, formatRelativeMinutes } from "./exports.js";
import { writePrivateTextFile } from "../core/private-files.js";
import { SessionManager } from "../core/session-manager.js";
import { getAvailableThinkingLevels, getEffectiveThinkingLevel } from "../ai/thinking.js";
import type { ModelHandle } from "../ai/providers.js";
import type { ExtensionHooks, SlashCommandApp } from "./slash-command-types.js";

type EmptyMenuKind = "extensions" | "resume" | "projects" | "packages" | "logout" | "templates" | "skills" | "changelog";

function describeRoots(roots: string[]): string {
  if (roots.length === 0) return "none";
  if (roots.length === 1) return roots[0]!;
  return `${roots.length} roots`;
}

function parseRoots(value: string): string[] {
  return value
    .split(/[;\r\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function openEmptyItemMenu(app: SlashCommandApp, title: string, detail: string, kind: EmptyMenuKind): false {
  app.openItemPicker(title, [{ id: "__none__", label: "None", detail }], () => {}, {
    closeOnSelect: false,
    kind,
  });
  return false;
}

function listLogoutTargets(): string[] {
  const configuredProviders = Object.entries(loadConfig().providers ?? {})
    .filter(([, entry]) => !!entry?.apiKey)
    .map(([provider]) => provider);
  return [...new Set([...configuredProviders, ...listAuthenticated()])].sort();
}

export function openSettingsMenu(args: {
  app: SlashCommandApp;
  activeModel: ModelHandle | null;
  currentMode: Mode;
  onModeChange: (mode: Mode) => void;
  onSystemPromptChange: (systemPrompt: string) => void;
}): void {
  const { app, activeModel, currentMode, onModeChange, onSystemPromptChange } = args;
  let menuMode = currentMode;
  const modeSwitchingPolicies = ["manual", "ask", "auto"] as const;
  function buildEntries() {
    const s = getSettings();
    const thinkingLevels = getAvailableThinkingLevels({
      providerId: activeModel?.provider?.id,
      modelId: activeModel?.modelId,
      runtime: activeModel?.runtime,
    });
    const effectiveThinking = getEffectiveThinkingLevel({
      providerId: activeModel?.provider?.id,
      modelId: activeModel?.modelId,
      runtime: activeModel?.runtime,
      level: s.thinkingLevel,
      enabled: s.enableThinking,
    });
    return [
      { key: "mode", label: "Mode", value: s.mode, description: "build / plan — default mode and current slash mode" },
      { key: "modeSwitching", label: "Mode switching", value: s.modeSwitching, description: "manual / ask / auto — switch build vs plan per turn" },
      { key: "autoCompact", label: "Auto-compact", value: String(s.autoCompact), description: "Automatically compress context when it gets too large" },
      { key: "autoSaveSessions", label: "Auto-save sessions", value: String(s.autoSaveSessions), description: "Save conversation history to disk" },
      { key: "thinkingLevel", label: "Thinking mode", value: effectiveThinking, description: `${thinkingLevels.join(" / ")} (ctrl+t to cycle)` },
      { key: "hideSidebar", label: "Hide sidebar", value: String(s.hideSidebar), description: "Hide the right sidebar panel" },
      { key: "autoRoute", label: "Auto-route", value: String(s.autoRoute), description: "Route simple tasks to cheaper model automatically" },
      { key: "showTokens", label: "Show tokens", value: String(s.showTokens), description: "Display token count in status bar" },
      { key: "showCost", label: "Show cost", value: String(s.showCost), description: "Display cost in status bar" },
      { key: "notifyOnResponse", label: "Notify on response", value: String(s.notifyOnResponse), description: "Show a desktop notification when a response completes" },
      { key: "quietStartup", label: "Quiet startup", value: String(s.quietStartup), description: "Hide startup inventory details" },
      { key: "hideThinkingBlock", label: "Hide thinking block", value: String(s.hideThinkingBlock), description: "Hide streamed reasoning blocks in chat" },
      { key: "cavemanLevel", label: "Caveman mode", value: s.cavemanLevel ?? "auto", description: "off / lite / auto / ultra — save output tokens (ctrl+y)" },
      { key: "editorPaddingX", label: "Editor padding", value: String(s.editorPaddingX), description: "Horizontal input padding (0-3)" },
      { key: "enableSkillCommands", label: "Skill commands", value: String(s.enableSkillCommands), description: "Allow /skill:name prompt shortcuts" },
      { key: "discoverExtensions", label: "Discover extensions", value: String(s.discoverExtensions), description: "Load extensions from configured paths" },
      { key: "discoverSkills", label: "Discover skills", value: String(s.discoverSkills), description: "Load skills from configured paths" },
      { key: "discoverPrompts", label: "Discover templates", value: String(s.discoverPrompts), description: "Load prompt templates from configured paths" },
      { key: "terminal.showImages", label: "Show image tags", value: String(s.terminal.showImages), description: "Show pasted image markers in chat" },
      { key: "images.blockImages", label: "Block images", value: String(s.images.blockImages), description: "Do not send pasted images to models" },
      { key: "autoLint", label: "Auto lint", value: String(s.autoLint), description: `Run ${s.lintCommand || "lint"} after model edits` },
      { key: "autoTest", label: "Auto test", value: String(s.autoTest), description: `Run ${s.testCommand || "tests"} after model edits` },
      { key: "autoFixValidation", label: "Auto-fix validation", value: String(s.autoFixValidation), description: "Send one automatic repair turn when lint/test fails" },
      { key: "autonomy.allowNetwork", label: "Autonomy: network", value: String(s.autonomy.allowNetwork), description: "Allow tool-driven network access without prompting" },
      { key: "autonomy.allowReadOutsideWorkspace", label: "Autonomy: read outside workspace", value: String(s.autonomy.allowReadOutsideWorkspace), description: "Allow reads outside the repo and trusted roots" },
      { key: "autonomy.allowWriteOutsideWorkspace", label: "Autonomy: write outside workspace", value: String(s.autonomy.allowWriteOutsideWorkspace), description: "Allow edits outside the repo and trusted roots" },
      { key: "autonomy.allowShellOutsideWorkspace", label: "Autonomy: shell outside workspace", value: String(s.autonomy.allowShellOutsideWorkspace), description: "Allow shell commands that target paths outside trusted roots" },
      { key: "autonomy.allowDestructiveShell", label: "Autonomy: destructive shell", value: String(s.autonomy.allowDestructiveShell), description: "Allow destructive shell patterns without blocking them" },
      { key: "autonomy.additionalReadRoots", label: "Autonomy: extra read roots", value: describeRoots(s.autonomy.additionalReadRoots), description: "Semicolon-separated trusted read-only paths" },
      { key: "autonomy.additionalWriteRoots", label: "Autonomy: extra write roots", value: describeRoots(s.autonomy.additionalWriteRoots), description: "Semicolon-separated trusted read/write paths" },
    ];
  }

  app.openSettings(buildEntries(), (key: string) => {
    const s = getSettings();
    const thinkingLevels = getAvailableThinkingLevels({
      providerId: activeModel?.provider?.id,
      modelId: activeModel?.modelId,
      runtime: activeModel?.runtime,
    });
    const val = s[key as keyof Settings];
    if (key === "mode") {
      const next = menuMode === "build" ? "plan" : "build";
      updateSetting("mode", next);
      menuMode = next;
      onModeChange(next);
      onSystemPromptChange(buildSystemPrompt(process.cwd(), activeModel?.provider?.id, next, s.cavemanLevel ?? "auto"));
    } else if (key === "modeSwitching") {
      const current = s.modeSwitching;
      const next = modeSwitchingPolicies[(modeSwitchingPolicies.indexOf(current as any) + 1) % modeSwitchingPolicies.length];
      updateSetting("modeSwitching", next);
    } else if (key === "thinkingLevel") {
      const current = getEffectiveThinkingLevel({
        providerId: activeModel?.provider?.id,
        modelId: activeModel?.modelId,
        runtime: activeModel?.runtime,
        level: s.thinkingLevel,
        enabled: s.enableThinking,
      });
      const next = thinkingLevels[(thinkingLevels.indexOf(current as any) + 1) % thinkingLevels.length];
      updateSetting("thinkingLevel", next);
      updateSetting("enableThinking", next !== "off");
    } else if (typeof val === "boolean") {
      updateSetting(key as keyof Settings, !val);
    } else if (key === "cavemanLevel") {
      const levels = ["off", "lite", "auto", "ultra"] as const;
      const current = s.cavemanLevel ?? "auto";
      const next = levels[(levels.indexOf(current as any) + 1) % levels.length];
      updateSetting("cavemanLevel", next);
      reloadContext();
      onSystemPromptChange(buildSystemPrompt(process.cwd(), activeModel?.provider?.id, menuMode, next));
    } else if (key === "editorPaddingX") {
      updateSetting("editorPaddingX", (s.editorPaddingX + 1) % 4);
    } else if (key === "terminal.showImages") {
      updateSetting("terminal", { ...s.terminal, showImages: !s.terminal.showImages });
    } else if (key === "images.blockImages") {
      updateSetting("images", { ...s.images, blockImages: !s.images.blockImages });
    } else if (key.startsWith("autonomy.")) {
      const autonomyKey = key.slice("autonomy.".length) as keyof AutonomySettings;
      if (autonomyKey === "additionalReadRoots" || autonomyKey === "additionalWriteRoots") {
        const currentRoots = s.autonomy[autonomyKey];
        void app.showQuestion(`Trusted ${autonomyKey === "additionalReadRoots" ? "read" : "write"} roots (; separated)`, [currentRoots.join("; ")]).then((value: string) => {
          const nextRoots = parseRoots(value);
          updateSetting("autonomy", { ...getSettings().autonomy, [autonomyKey]: nextRoots });
          app.updateSettings(buildEntries());
        });
        return;
      }
      updateSetting("autonomy", { ...s.autonomy, [autonomyKey]: !s.autonomy[autonomyKey] });
    }
    app.updateSettings(buildEntries());
  });
}

export function openExtensionsMenu(app: SlashCommandApp, hooks: ExtensionHooks): boolean {
  const extensions = listExtensions();
  if (extensions.length === 0) {
    return openEmptyItemMenu(app, "Extensions", "~/.brokecli/extensions is empty", "extensions");
  }
  const buildExtensionItems = () => listExtensions().map((entry) => ({ id: entry.id, label: entry.id, detail: entry.enabled ? "enabled" : "disabled" }));
  app.openItemPicker("Extensions", buildExtensionItems(), (id: string) => {
    toggleExtensionEnabled(id);
    hooks.reload?.();
    app.updateItemPickerItems?.(buildExtensionItems(), id);
  }, { closeOnSelect: false, kind: "extensions" });
  return true;
}

export async function openPackagesMenu(app: SlashCommandApp, restText = ""): Promise<boolean> {
  const query = restText.trim();
  if (query) {
    const results = await searchPackageRegistry(query, 12);
    if (results.length === 0) {
      return openEmptyItemMenu(app, "Package Search", `no npm packages for \"${query}\"`, "packages");
    }
    const items = results.map((entry) => {
      const resourceParts = [
        entry.resources.extensions ? `${entry.resources.extensions} ext` : "",
        entry.resources.skills ? `${entry.resources.skills} skill` : "",
        entry.resources.prompts ? `${entry.resources.prompts} prompt` : "",
        entry.resources.themes ? `${entry.resources.themes} theme` : "",
      ].filter(Boolean).join(" · ");
      return {
        id: entry.source,
        label: entry.name,
        detail: [entry.version, resourceParts || "-", entry.description].filter(Boolean).join(" · "),
      };
    });
    app.openItemPicker("Package Search", items, (source: string) => {
      void installPackage(source).then(() => {
        app.setStatus?.(`Installed ${source}`);
      }).catch((error: Error) => {
        app.setStatus?.(`Package install failed: ${error.message}`);
      });
    }, { kind: "packages" });
    return true;
  }

  const packages = listInstalledPackages();
  if (packages.length === 0) {
    return openEmptyItemMenu(app, "Packages", "no configured packages", "packages");
  }
  const items = packages.map((entry) => {
    const resources = entry.installed ? describePackageResources(entry.root) : { extensions: [], skills: [], prompts: [], themes: [] };
    const detail = [
      entry.scope,
      entry.installed ? "installed" : "missing",
      resources.extensions.length ? `${resources.extensions.length} ext` : "",
      resources.skills.length ? `${resources.skills.length} skill` : "",
      resources.prompts.length ? `${resources.prompts.length} prompt` : "",
      resources.themes.length ? `${resources.themes.length} theme` : "",
    ].filter(Boolean).join(" · ");
    return {
      id: `${entry.scope}:${entry.source}`,
      label: entry.source,
      detail,
    };
  });
  app.openItemPicker("Packages", items, () => {}, { kind: "packages", closeOnSelect: false });
  return true;
}

export function openExportMenu(args: { app: SlashCommandApp; session: Session; activeModel: ModelHandle | null; currentModelId: string; text: string; }): void {
  const { app, session, activeModel, currentModelId, text } = args;
  const items = [
    { id: "markdown", label: "Markdown", detail: ".md file format" },
    { id: "html", label: "HTML", detail: "standalone HTML file" },
    { id: "copy-markdown", label: "Copy Markdown", detail: "copy full transcript" },
  ];
  app.openItemPicker("Export format", items, (id: string) => {
    const shouldCopy = id === "copy-markdown";
    const defaultPath = `transcript-export.${id === "html" ? "html" : "md"}`;
    const filePath = text.slice(8).trim() || defaultPath;
    const msgs = session.getMessages();
    const content = id === "html"
      ? buildHtmlExport(msgs, activeModel?.provider.name ?? "unknown", currentModelId || "unknown", process.cwd())
      : buildMarkdownExport(msgs, activeModel?.provider.name ?? "unknown", currentModelId || "unknown", process.cwd());
    try {
      if (shouldCopy) {
        if (process.platform === "win32") execSync("clip", { input: content });
        else if (process.platform === "darwin") execSync("pbcopy", { input: content });
        else execSync("xclip -selection clipboard", { input: content });
        app.setStatus?.("Transcript copied.");
      } else {
        writePrivateTextFile(filePath, content);
        app.setStatus?.(`Exported to ${filePath}`);
      }
    } catch (err) {
      app.setStatus?.(`Export failed: ${(err as Error).message}`);
    }
  }, { kind: "export" });
}

export function openResumeMenu(args: { app: SlashCommandApp; restText: string; onSessionReplace: (session: Session) => void; }): boolean {
  const { app, restText, onSessionReplace } = args;
  if (!getSettings().autoSaveSessions) {
    return openEmptyItemMenu(app, "Resume Session", "session history is off", "resume");
  }
  const recent = Session.listRecent(50, restText, process.cwd());
  if (recent.length === 0) {
    return openEmptyItemMenu(app, "Resume Session", "no saved sessions in this project", "resume");
  }
  const items = recent.map((entry) => ({
    id: entry.id,
    label: entry.preview || entry.model || "unknown",
    detail: `${entry.model || "unknown"} · ${entry.messageCount} msgs · ${formatRelativeMinutes(entry.updatedAt)}`,
  }));
  app.openItemPicker("Resume Session", items, (sessionId: string) => {
    const loaded = Session.load(sessionId);
    if (!loaded) return;
    onSessionReplace(loaded);
    app.clearMessages();
    for (const msg of loaded.getMessages()) app.addMessage(msg.role, msg.content);
    app.updateUsage(loaded.getTotalCost(), loaded.getTotalInputTokens(), loaded.getTotalOutputTokens());
  }, { kind: "resume" });
  return true;
}

export function openProjectsMenu(app: SlashCommandApp, restText: string, onProjectChange: (cwd: string) => void): boolean {
  const projects = listProjects(20, restText);
  if (projects.length === 0) {
    return openEmptyItemMenu(app, "Projects", "no saved projects yet", "projects");
  }
  const items = projects.map((entry) => ({
    id: entry.cwd,
    label: entry.cwd,
    detail: `${entry.lastInstruction.slice(0, 60)} · ${formatRelativeMinutes(entry.lastAccessed)}`,
  }));
  app.openItemPicker("Projects", items, (cwd: string) => onProjectChange(cwd), { kind: "projects" });
  return true;
}

export async function handleLogoutMenu(args: { app: SlashCommandApp; restText: string; activeModel: ModelHandle | null; refreshProviderState: (force?: boolean) => Promise<any>; }): Promise<void> {
  const { app, restText, activeModel, refreshProviderState } = args;
  const executeLogout = async (requestedTarget: string) => {
    const normalized = requestedTarget.trim().toLowerCase();
    const knownTargets = listLogoutTargets();
    const targets = normalized === "all" ? knownTargets : normalized ? [normalized] : [];
    if (targets.length === 0) {
      app.setStatus?.("No stored credentials found to clear.");
      return;
    }
    const cleared: string[] = [];
    const external: string[] = [];
    for (const provider of targets) {
      const credential = getProviderCredential(provider);
      const hasStoredConfigKey = !!loadConfig().providers?.[provider]?.apiKey;
      const hadStoredAuth = hasStoredCredentials(provider);
      clearCredentials(provider);
      if (hasStoredConfigKey) updateProviderConfig(provider, { apiKey: null });
      if (credential.kind === "api_key" && (credential.source === "config" || credential.source === undefined)) {
        cleared.push(provider);
        continue;
      }
      if (credential.kind !== "none" && credential.source && credential.source !== "config") {
        external.push(`${provider} (${credential.source})`);
        continue;
      }
      if (hasStoredConfigKey || hadStoredAuth) cleared.push(provider);
    }
    if (normalized === "all" || (activeModel && targets.includes(activeModel.provider.id))) updateSetting("lastModel", "");
    await refreshProviderState(true);
    if (cleared.length > 0) app.setStatus?.(`Cleared stored auth for: ${cleared.join(", ")}`);
    else if (external.length > 0) app.setStatus?.(`External env/native auth still active: ${external.join(", ")}`);
    else app.setStatus?.("No stored credentials found to clear.");
  };

  if (restText) {
    await executeLogout(restText);
    return;
  }
  const targets = listLogoutTargets();
  if (targets.length === 0) {
    openEmptyItemMenu(app, "Logout", "no stored credentials", "logout");
    return;
  }
  const items = [
    { id: "all", label: "all", detail: `clear ${targets.length} stored provider entr${targets.length === 1 ? "y" : "ies"}` },
    ...targets.map((provider) => ({ id: provider, label: provider, detail: getProviderCredential(provider).source ?? "stored auth" })),
  ];
  app.openItemPicker("Logout", items, (id: string) => { void executeLogout(id); }, { kind: "logout" });
}
