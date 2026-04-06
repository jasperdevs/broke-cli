import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { buildSystemPrompt, reloadContext } from "../core/context.js";
import { clearCredentials, hasStoredCredentials, listAuthenticated } from "../core/auth.js";
import { getProviderCredential, getSettings, loadConfig, updateProviderConfig, updateSetting, type Mode, type Settings, type TreeFilterMode } from "../core/config.js";
import { listProjects } from "../core/projects.js";
import { listExtensions } from "../core/extensions.js";
import { isToolAllowed, toggleExtensionEnabled, toggleToolPermission } from "../core/permissions.js";
import { Session } from "../core/session.js";
import { listThemes, setPreviewTheme } from "../core/themes.js";
import { TOOL_NAMES } from "../tools/registry.js";
import type { Keypress } from "../tui/keypress.js";
import { buildHtmlExport, buildMarkdownExport, buildShareFilePath, formatRelativeMinutes, publishTranscriptShare } from "./exports.js";
import { SessionManager } from "../core/session-manager.js";

type AnyApp = any;
type AnyHooks = any;

function listLogoutTargets(): string[] {
  const configuredProviders = Object.entries(loadConfig().providers ?? {})
    .filter(([, entry]) => !!entry?.apiKey)
    .map(([provider]) => provider);
  return [...new Set([...configuredProviders, ...listAuthenticated()])].sort();
}

export function openSettingsMenu(args: { app: AnyApp; activeModel: any; currentMode: Mode; onSystemPromptChange: (systemPrompt: string) => void; }): void {
  const { app, activeModel, currentMode, onSystemPromptChange } = args;
  function buildEntries() {
    const s = getSettings();
    return [
      { key: "yoloMode", label: "Yolo mode", value: String(s.yoloMode), description: "Run commands without safety checks" },
      { key: "autoCompact", label: "Auto-compact", value: String(s.autoCompact), description: "Automatically compress context when it gets too large" },
      { key: "autoSaveSessions", label: "Auto-save sessions", value: String(s.autoSaveSessions), description: "Save conversation history to disk" },
      { key: "gitCheckpoints", label: "Git checkpoints", value: String(s.gitCheckpoints), description: "Auto-commit before file modifications" },
      { key: "thinkingLevel", label: "Thinking mode", value: s.thinkingLevel || (s.enableThinking ? "low" : "off"), description: "off / low / medium / high (ctrl+t to cycle)" },
      { key: "hideSidebar", label: "Hide sidebar", value: String(s.hideSidebar), description: "Hide the right sidebar panel" },
      { key: "autoRoute", label: "Auto-route", value: String(s.autoRoute), description: "Route simple tasks to cheaper model automatically" },
      { key: "showTokens", label: "Show tokens", value: String(s.showTokens), description: "Display token count in status bar" },
      { key: "showCost", label: "Show cost", value: String(s.showCost), description: "Display cost in status bar" },
      { key: "maxSessionCost", label: "Max session cost", value: s.maxSessionCost === 0 ? "unlimited" : `$${s.maxSessionCost}`, description: "Maximum cost per session (0 = unlimited)" },
      { key: "notifyOnResponse", label: "Notify on response", value: String(s.notifyOnResponse), description: "Show a desktop notification when a response completes" },
      { key: "quietStartup", label: "Quiet startup", value: String(s.quietStartup), description: "Hide startup inventory details" },
      { key: "hideThinkingBlock", label: "Hide thinking block", value: String(s.hideThinkingBlock), description: "Hide streamed reasoning blocks in chat" },
      { key: "cavemanLevel", label: "Caveman mode", value: s.cavemanLevel ?? "off", description: "off / lite / auto / ultra — save output tokens (ctrl+y)" },
      { key: "doubleEscapeAction", label: "Double-escape", value: s.doubleEscapeAction, description: "tree / fork / none" },
      { key: "editorPaddingX", label: "Editor padding", value: String(s.editorPaddingX), description: "Horizontal input padding (0-3)" },
      { key: "autocompleteMaxVisible", label: "Autocomplete size", value: String(s.autocompleteMaxVisible), description: "Visible command rows" },
      { key: "showHardwareCursor", label: "Hardware cursor", value: String(s.showHardwareCursor), description: "Keep the terminal cursor visible while idle" },
      { key: "terminal.showImages", label: "Show image tags", value: String(s.terminal.showImages), description: "Show pasted image markers in chat" },
      { key: "images.blockImages", label: "Block images", value: String(s.images.blockImages), description: "Do not send pasted images to models" },
      { key: "autoLint", label: "Auto lint", value: String(s.autoLint), description: `Run ${s.lintCommand || "lint"} after model edits` },
      { key: "autoTest", label: "Auto test", value: String(s.autoTest), description: `Run ${s.testCommand || "tests"} after model edits` },
      { key: "autoFixValidation", label: "Auto-fix validation", value: String(s.autoFixValidation), description: "Send one automatic repair turn when lint/test fails" },
    ];
  }

  app.openSettings(buildEntries(), (key: string) => {
    const s = getSettings();
    const val = s[key as keyof Settings];
    if (key === "thinkingLevel") {
      const levels = ["off", "low", "medium", "high"] as const;
      const current = s.thinkingLevel || (s.enableThinking ? "low" : "off");
      const next = levels[(levels.indexOf(current as any) + 1) % levels.length];
      updateSetting("thinkingLevel", next);
      updateSetting("enableThinking", next !== "off");
    } else if (typeof val === "boolean") {
      updateSetting(key as keyof Settings, !val);
    } else if (key === "maxSessionCost") {
      const next = s.maxSessionCost === 0 ? 1 : s.maxSessionCost === 1 ? 5 : s.maxSessionCost === 5 ? 10 : 0;
      updateSetting("maxSessionCost", next);
    } else if (key === "cavemanLevel") {
      const levels = ["off", "lite", "auto", "ultra"] as const;
      const current = s.cavemanLevel ?? "off";
      const next = levels[(levels.indexOf(current as any) + 1) % levels.length];
      updateSetting("cavemanLevel", next);
      reloadContext();
      onSystemPromptChange(buildSystemPrompt(process.cwd(), activeModel?.provider?.id, currentMode, next));
    } else if (key === "doubleEscapeAction") {
      const levels: Array<Settings["doubleEscapeAction"]> = ["tree", "fork", "none"];
      const next = levels[(levels.indexOf(s.doubleEscapeAction) + 1) % levels.length];
      updateSetting("doubleEscapeAction", next);
    } else if (key === "editorPaddingX") {
      updateSetting("editorPaddingX", (s.editorPaddingX + 1) % 4);
    } else if (key === "autocompleteMaxVisible") {
      const cycle = [5, 8, 12];
      const idx = cycle.indexOf(s.autocompleteMaxVisible);
      updateSetting("autocompleteMaxVisible", cycle[(idx + 1) % cycle.length] ?? 5);
    } else if (key === "terminal.showImages") {
      updateSetting("terminal", { ...s.terminal, showImages: !s.terminal.showImages });
    } else if (key === "images.blockImages") {
      updateSetting("images", { ...s.images, blockImages: !s.images.blockImages });
    }
    app.updateSettings(buildEntries());
  });
}

export function openPermissionsMenu(app: AnyApp): void {
  const buildPermissionItems = () => TOOL_NAMES.map((name) => ({ id: name, label: name, detail: isToolAllowed(name) ? "allowed" : "blocked" }));
  app.openItemPicker("Tool permissions", buildPermissionItems(), (id: string) => {
    toggleToolPermission(id);
    app.updateItemPickerItems?.(buildPermissionItems(), id);
  }, { closeOnSelect: false, kind: "permissions" });
}

export function openExtensionsMenu(app: AnyApp, hooks: AnyHooks): boolean {
  const extensions = listExtensions();
  if (extensions.length === 0) {
    app.addMessage("system", "No extensions found in ~/.brokecli/extensions.");
    return false;
  }
  const buildExtensionItems = () => listExtensions().map((entry) => ({ id: entry.id, label: entry.id, detail: entry.enabled ? "enabled" : "disabled" }));
  app.openItemPicker("Extensions", buildExtensionItems(), (id: string) => {
    toggleExtensionEnabled(id);
    hooks.reload?.();
    app.updateItemPickerItems?.(buildExtensionItems(), id);
  }, { closeOnSelect: false, kind: "extensions" });
  return true;
}

export function openThemeMenu(app: AnyApp): void {
  const themes = listThemes();
  const previousTheme = getSettings().theme;
  const buildThemeItems = () => {
    const favoriteThemes = getSettings().favoriteThemes ?? [];
    const order = [...themes].sort((a, b) => {
      const aDefault = a.key === "brokecli-dark" || a.key === "brokecli-light" ? 0 : 1;
      const bDefault = b.key === "brokecli-dark" || b.key === "brokecli-light" ? 0 : 1;
      if (aDefault !== bDefault) return aDefault - bDefault;
      const aFav = favoriteThemes.includes(a.key) ? 0 : 1;
      const bFav = favoriteThemes.includes(b.key) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return themes.findIndex((theme) => theme.key === a.key) - themes.findIndex((theme) => theme.key === b.key);
    });
    return order.map((theme) => ({
      id: theme.key,
      label: theme.label,
      detail: `${favoriteThemes.includes(theme.key) ? "★ " : ""}${theme.dark ? "dark" : "light"}`,
    }));
  };
  const themeItems = buildThemeItems();
  const currentIdx = Math.max(0, themeItems.findIndex((theme) => theme.id === previousTheme));
  app.openItemPicker("Theme", themeItems, (themeId: string) => {
    setPreviewTheme(null);
    updateSetting("theme", themeId);
  }, {
    initialCursor: currentIdx,
    kind: "theme",
    onPreview: (themeId: string) => setPreviewTheme(themeId),
    onCancel: () => setPreviewTheme(null),
  });
}

export function openExportMenu(args: { app: AnyApp; session: Session; activeModel: any; currentModelId: string; text: string; }): void {
  const { app, session, activeModel, currentModelId, text } = args;
  const items = [
    { id: "markdown", label: "Markdown", detail: ".md file format" },
    { id: "html", label: "HTML", detail: "standalone HTML file" },
    { id: "copy-markdown", label: "Copy Markdown", detail: "copy full transcript" },
  ];
  app.openItemPicker("Export format", items, (id: string) => {
    const shouldCopy = id === "copy-markdown";
    const defaultPath = `brokecli-export.${id === "html" ? "html" : "md"}`;
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
        app.addMessage("system", "Transcript copied.");
      } else {
        writeFileSync(filePath, content, "utf-8");
        app.addMessage("system", `Exported to ${filePath}`);
      }
    } catch (err) {
      app.addMessage("system", `Export failed: ${(err as Error).message}`);
    }
  }, { kind: "export" });
}

export async function shareTranscript(args: { app: AnyApp; session: Session; activeModel: any; currentModelId: string; }): Promise<void> {
  const { app, session, activeModel, currentModelId } = args;
  const msgs = session.getMessages();
  if (msgs.length === 0) {
    app.addMessage("system", "Nothing to share yet.");
    return;
  }
  const filePath = buildShareFilePath(msgs, process.cwd());
  const content = buildHtmlExport(msgs, activeModel?.provider.name ?? "unknown", currentModelId || "unknown", process.cwd());
  const share = await publishTranscriptShare({ html: content, filePath, description: `BrokeCLI transcript from ${process.cwd()}` });
  const shareUrl = share.url;
  try {
    if (process.platform === "win32") execSync("clip", { input: shareUrl });
    else if (process.platform === "darwin") execSync("pbcopy", { input: shareUrl });
    else execSync("xclip -selection clipboard", { input: shareUrl });
    app.addMessage("system", share.kind === "gist" ? `Shared to ${share.url} (link copied)` : `Shared to ${share.filePath} (link copied)`);
  } catch {
    app.addMessage("system", share.kind === "gist" ? `Shared to ${share.url}` : `Shared to ${share.filePath}`);
  }
}

export function openResumeMenu(args: { app: AnyApp; restText: string; onSessionReplace: (session: Session) => void; }): boolean {
  const { app, restText, onSessionReplace } = args;
  if (!getSettings().autoSaveSessions) {
    app.addMessage("system", "Session history is off. Enable Auto-save sessions in /settings to use /resume.");
    return false;
  }
  const recent = Session.listRecent(50, restText, process.cwd());
  if (recent.length === 0) {
    app.addMessage("system", "No saved sessions found.");
    return false;
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

export function openTreeMenu(args: {
  app: AnyApp;
  session: Session;
  onSessionReplace?: (session: Session) => void;
}): boolean {
  const { app, session } = args;
  let filterMode: TreeFilterMode = getSettings().treeFilterMode;
  let showTimestamps = false;
  const filterModes: TreeFilterMode[] = ["default", "no-tools", "user-only", "labeled-only", "all"];
  const collapsed = new Set<string>();

  const buildChildrenMap = () => {
    const map = new Map<string, string[]>();
    for (const entry of session.getTreeItems("all")) {
      if (!entry.parentId) continue;
      const bucket = map.get(entry.parentId) ?? [];
      bucket.push(entry.id);
      map.set(entry.parentId, bucket);
    }
    return map;
  };
  const childrenMap = buildChildrenMap();

  const visibleEntries = () => {
    const source = session.getTreeItems(filterMode);
    const hidden = new Set<string>();
    const byId = new Map(source.map((entry) => [entry.id, entry]));
    for (const entry of source) {
      let cursor = entry.parentId ? byId.get(entry.parentId) : undefined;
      while (cursor) {
        if (collapsed.has(cursor.id)) {
          hidden.add(entry.id);
          break;
        }
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
    }
    return source.filter((entry) => !hidden.has(entry.id));
  };

  const buildItems = () => visibleEntries().map((entry) => {
    const hasChildren = (childrenMap.get(entry.id)?.length ?? 0) > 0;
    const branch = hasChildren ? (collapsed.has(entry.id) ? "▸" : "▾") : "•";
    const active = entry.active ? " [active]" : "";
    const label = entry.label ? ` · #${entry.label}` : "";
    const summary = entry.content.split(/\r?\n/)[0]?.trim() || entry.role;
    const indent = "  ".repeat(entry.depth);
    const time = showTimestamps ? ` · ${formatRelativeMinutes(entry.timestamp)}` : "";
    return {
      id: entry.id,
      label: `${indent}${branch} ${entry.role}${active}${label}`,
      detail: `${summary.slice(0, 80)}${time}`,
    };
  });

  const items = buildItems();
  if (items.length === 0) {
    app.addMessage("system", filterMode === "all" ? "No session tree yet." : `No tree items for filter "${filterMode}".`);
    return false;
  }

  const refreshItems = (focusId?: string) => {
    app.updateItemPickerItems?.(buildItems(), focusId);
  };
  const cycleFilter = () => {
    filterMode = filterModes[(filterModes.indexOf(filterMode) + 1) % filterModes.length];
    updateSetting("treeFilterMode", filterMode);
    refreshItems();
  };

  app.openItemPicker("Session Tree", items, (entryId: string) => {
    const result = session.navigateTo(entryId);
    if (result.cancelled) return;
    app.clearMessages();
    for (const msg of session.getMessages()) app.addMessage(msg.role, msg.content);
    app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
    if (result.editorText) app.setDraft?.(result.editorText);
  }, {
    kind: "tree",
    initialCursor: Math.max(0, items.findIndex((item) => item.id === session.getLeafId())),
    onKey: (key: Keypress) => {
      if (key.ctrl && key.name === "o") {
        cycleFilter();
        return true;
      }
      if (key.shift && key.name === "t") {
        showTimestamps = !showTimestamps;
        refreshItems();
        return true;
      }
      if (key.shift && key.name === "l") {
        const filtered = app.getFilteredItems?.() ?? buildItems();
        const current = filtered[(app.itemPicker?.cursor ?? 0)];
        if (!current) return true;
        session.toggleLabel(current.id);
        refreshItems(current.id);
        return true;
      }
      if ((key.ctrl || key.meta) && ["left", "right"].includes(key.name)) {
        const filtered = app.getFilteredItems?.() ?? buildItems();
        const current = filtered[(app.itemPicker?.cursor ?? 0)];
        if (!current) return true;
        const entry = session.getTreeEntry(current.id);
        if (!entry) return true;
        const hasChildren = (childrenMap.get(entry.id)?.length ?? 0) > 0;
        if (key.name === "right") {
          if (collapsed.has(entry.id)) {
            collapsed.delete(entry.id);
            refreshItems(entry.id);
          } else {
            const children = childrenMap.get(entry.id) ?? [];
            const nextChild = filtered.find((item: { id: string }) => children.includes(item.id));
            if (nextChild) refreshItems(nextChild.id);
          }
          return true;
        }
        if (key.name === "left") {
          if (hasChildren && !collapsed.has(entry.id)) {
            collapsed.add(entry.id);
            refreshItems(entry.id);
          } else if (entry.parentId) {
            refreshItems(entry.parentId);
          }
          return true;
        }
      }
      if (key.name === "left" || key.name === "right") {
        const filtered = app.getFilteredItems?.() ?? buildItems();
        if (filtered.length === 0 || !app.itemPicker) return true;
        const delta = key.name === "left" ? -10 : 10;
        app.itemPicker.cursor = Math.max(0, Math.min(filtered.length - 1, app.itemPicker.cursor + delta));
        return true;
      }
      return false;
    },
    secondaryHint: "ctrl+o filter · shift+l label · shift+t time · alt/ctrl+←/→ fold",
  });
  return true;
}

export function openProjectsMenu(app: AnyApp, restText: string, onProjectChange: (cwd: string) => void): boolean {
  const projects = listProjects(20, restText);
  if (projects.length === 0) {
    app.addMessage("system", "No saved projects yet.");
    return false;
  }
  const items = projects.map((entry) => ({
    id: entry.cwd,
    label: entry.cwd,
    detail: `${entry.lastInstruction.slice(0, 60)} · ${formatRelativeMinutes(entry.lastAccessed)}`,
  }));
  app.openItemPicker("Projects", items, (cwd: string) => onProjectChange(cwd), { kind: "projects" });
  return true;
}

export async function handleLogoutMenu(args: { app: AnyApp; restText: string; activeModel: any; refreshProviderState: (force?: boolean) => Promise<any>; }): Promise<void> {
  const { app, restText, activeModel, refreshProviderState } = args;
  const executeLogout = async (requestedTarget: string) => {
    const normalized = requestedTarget.trim().toLowerCase();
    const knownTargets = listLogoutTargets();
    const targets = normalized === "all" ? knownTargets : normalized ? [normalized] : [];
    if (targets.length === 0) {
      app.addMessage("system", "No stored brokecli credentials found to clear.");
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
    if (cleared.length > 0) app.addMessage("system", `Cleared stored brokecli auth for: ${cleared.join(", ")}`);
    if (external.length > 0) app.addMessage("system", `External env/native auth still active: ${external.join(", ")}`);
    if (cleared.length === 0 && external.length === 0) app.addMessage("system", "No stored brokecli credentials found to clear.");
  };

  if (restText) {
    await executeLogout(restText);
    return;
  }
  const targets = listLogoutTargets();
  if (targets.length === 0) {
    app.addMessage("system", "No stored brokecli credentials found to clear.");
    return;
  }
  const items = [
    { id: "all", label: "all", detail: `clear ${targets.length} stored provider entr${targets.length === 1 ? "y" : "ies"}` },
    ...targets.map((provider) => ({ id: provider, label: provider, detail: getProviderCredential(provider).source ?? "stored auth" })),
  ];
  app.openItemPicker("Logout", items, (id: string) => { void executeLogout(id); }, { kind: "logout" });
}
