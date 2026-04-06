import { execSync } from "child_process";
import { writeFileSync } from "fs";
import type { ModelHandle } from "../ai/providers.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import { buildSystemPrompt, reloadContext } from "../core/context.js";
import { buildAggregateBudgetReport, buildBudgetReport, renderBudgetDashboard, type BudgetReport } from "../core/budget-insights.js";
import { compactMessages, getTotalContextTokens } from "../core/compact.js";
import { APP_VERSION } from "../core/app-meta.js";
import { clearCredentials, hasStoredCredentials, listAuthenticated } from "../core/auth.js";
import { getProviderCredential, getSettings, loadConfig, updateProviderConfig, updateSetting, type Settings, type Mode } from "../core/config.js";
import { listProjects } from "../core/projects.js";
import { listExtensions } from "../core/extensions.js";
import { loadKeybindings, reloadKeybindings } from "../core/keybindings.js";
import { isToolAllowed, toggleExtensionEnabled, toggleToolPermission } from "../core/permissions.js";
import { Session } from "../core/session.js";
import { listSkills, loadSkillPrompt } from "../core/skills.js";
import { listTemplates, loadTemplate } from "../core/templates.js";
import { undoLastCheckpoint } from "../core/git.js";
import { checkForNewVersion } from "../core/update.js";
import { formatRelativeMinutes } from "./exports.js";
import { runConnectFlow } from "./connect-flow.js";
import { runLoginFlow } from "./login-flow.js";
import { handleLogoutMenu, openExportMenu, openExtensionsMenu, openPermissionsMenu, openProjectsMenu, openResumeMenu, openSettingsMenu, openThemeMenu, shareTranscript } from "./slash-command-menus.js";
import type { ModelOption, SettingEntry, PickerItem, UpdateNotice } from "../tui/app-types.js";
import { SessionManager } from "../core/session-manager.js";

interface SlashCommandApp {
  addMessage(role: "user" | "assistant" | "system", content: string): void;
  clearMessages(): void;
  resetCost(): void;
  setModel(provider: string, model: string): void;
  setSessionName?(name: string): void;
  setDraft?(text: string): void;
  updateUsage(cost: number, inputTokens: number, outputTokens: number): void;
  openModelPicker(
    options: ModelOption[],
    onSelect: (providerId: string, modelId: string) => void,
    onPin?: (providerId: string, modelId: string, pinned: boolean) => void,
    initialCursor?: number,
    initialScope?: "all" | "scoped",
  ): void;
  openSettings(entries: SettingEntry[], onToggle: (key: string) => void): void;
  updateSettings(entries: SettingEntry[]): void;
  openItemPicker(
    title: string,
    items: PickerItem[],
    onSelect: (id: string) => void,
    options?: {
      initialCursor?: number;
      previewHint?: string;
      onPreview?: (id: string) => void;
      onCancel?: () => void;
      onSecondaryAction?: (id: string) => void;
      secondaryHint?: string;
      closeOnSelect?: boolean;
      kind?: "login" | "connect" | "permissions" | "extensions" | "theme" | "export" | "resume" | "session" | "hotkeys" | "projects" | "logout" | "agents";
    },
  ): void;
  openAgentRunsView?(title: string, runs: Array<{ id: string; prompt: string; status: "running" | "done" | "error"; result?: string; detail?: string; createdAt: number }>): void;
  getAgentRuns?(): Array<{ id: string; prompt: string; status: "running" | "done" | "error"; result?: string; detail?: string; createdAt: number }>;
  stop(): void;
  cycleCavemanMode(): void;
  cycleThinkingMode(): void;
  getLastAssistantContent(): string;
  getFileContexts(): Map<string, string>;
  showQuestion(prompt: string, options?: string[]): Promise<string>;
  runExternalCommand?(title: string, command: string, args: string[]): number;
  setUpdateNotice?(notice: UpdateNotice | null): void;
  clearUpdateNotice?(): void;
  updateItemPickerItems?(items: PickerItem[], focusId?: string): void;
  setCompacting?(compacting: boolean, tokenCount?: number): void;
  openBudgetView?(title: string, reports: { all: BudgetReport; session: BudgetReport }, scope?: "all" | "session"): void;
}

async function loadBudgetReports(session: Session): Promise<{ all: BudgetReport; session: BudgetReport }> {
  const sessionDir = getSettings().sessionDir?.trim() || undefined;
  const allEntries = await SessionManager.listAll(process.cwd(), sessionDir);
  const sessions = allEntries
    .map((entry) => Session.load(entry.id))
    .filter((entry): entry is Session => !!entry);
  if (!sessions.some((entry) => entry.getId() === session.getId())) sessions.unshift(session);
  return {
    all: buildAggregateBudgetReport(sessions),
    session: buildBudgetReport(session),
  };
}

interface ExtensionHooks {
  emit(event: string, payload: Record<string, unknown>): void;
  reload?(): void;
}

export interface SlashCommandResult {
  handled: boolean;
  templateLoaded?: boolean;
}

export async function handleSlashCommand(options: {
  text: string;
  app: SlashCommandApp;
  session: Session;
  activeModel: ModelHandle | null;
  currentModelId: string;
  currentMode: Mode;
  systemPrompt: string;
  providerRegistry: ProviderRegistry;
  buildVisibleModelOptions: () => ModelOption[];
  refreshProviderState: (force?: boolean) => Promise<Awaited<ReturnType<ProviderRegistry["refresh"]>>>;
  isSkippedPromptAnswer: (value: string | undefined | null) => boolean;
  isValidHttpBaseUrl: (value: string) => boolean;
  getContextOptimizer: () => ReturnType<Session["getContextOptimizer"]>;
  onSessionReplace: (session: Session) => void;
  onModelChange: (model: ModelHandle, modelId: string) => void;
  onSystemPromptChange: (systemPrompt: string) => void;
  hooks: ExtensionHooks;
  onProjectChange: (cwd: string) => void;
}): Promise<SlashCommandResult> {
  const {
    text,
    app,
    session,
    activeModel,
    currentModelId,
    currentMode,
    systemPrompt,
    providerRegistry,
    buildVisibleModelOptions,
    refreshProviderState,
    isSkippedPromptAnswer,
    isValidHttpBaseUrl,
    getContextOptimizer,
    onSessionReplace,
    onModelChange,
    onSystemPromptChange,
    hooks,
    onProjectChange,
  } = options;

  const [cmd, ...restParts] = text.slice(1).split(" ");
  const restText = restParts.join(" ").trim();

  switch (cmd) {
    case "help":
      app.addMessage("system", "Type / to see available commands.");
      return { handled: true };
    case "new":
    case "clear":
      session.clear();
      app.clearMessages();
      app.resetCost();
      getContextOptimizer().reset();
      return { handled: true };
    case "connect":
      await runConnectFlow({
        providerId: restText || undefined,
        app,
        providerRegistry,
        refreshProviderState,
        isSkippedPromptAnswer,
        isValidHttpBaseUrl,
      });
      return { handled: true };
    case "login":
      await runLoginFlow({
        providerId: restText || undefined,
        app,
        providerRegistry,
        refreshProviderState,
      });
      return { handled: true };
    case "model": {
      const allOptions = buildVisibleModelOptions();
      if (allOptions.length === 0) {
        app.addMessage("system", "No connected providers found. Run /connect.");
        return { handled: true };
      }
      app.openModelPicker(allOptions, (provId, modId) => {
        try {
          const nextModel = providerRegistry.createModel(provId, modId);
          onModelChange(nextModel, modId);
          app.setModel(nextModel.provider.name, modId);
          session.setProviderModel(nextModel.provider.name, modId);
          updateSetting("lastModel", `${provId}/${modId}`);
        } catch (err) {
          app.addMessage("system", `Failed: ${(err as Error).message}`);
        }
      }, (provId, modId, pinned) => {
        const key = `${provId}/${modId}`;
        const scoped = getSettings().scopedModels;
        if (pinned && !scoped.includes(key)) updateSetting("scopedModels", [...scoped, key]);
        else if (!pinned) updateSetting("scopedModels", scoped.filter((entry: string) => entry !== key));
      }, 0);
      return { handled: true };
    }
    case "settings": {
      openSettingsMenu({ app, activeModel, currentMode, onSystemPromptChange });
      return { handled: true };
    }
    case "permissions": {
      openPermissionsMenu(app);
      return { handled: true };
    }
    case "extensions": {
      openExtensionsMenu(app, hooks);
      return { handled: true };
    }
    case "theme": {
      openThemeMenu(app);
      return { handled: true };
    }
    case "compact": {
      if (!activeModel) {
        app.addMessage("system", "No model available for compaction.");
        return { handled: true };
      }
      hooks.emit("on_message", { role: "user", content: text });
      try {
        const chatMsgs = session.getChatMessages();
        const ctxTokens = getTotalContextTokens(chatMsgs, systemPrompt, currentModelId);
        app.setCompacting?.(true, ctxTokens);
        const compacted = activeModel.runtime === "sdk" && activeModel.model
          ? await compactMessages(chatMsgs, activeModel.model)
          : chatMsgs.slice(-6);
        session.replaceConversation(compacted);
        session.recordCompaction();
        app.setCompacting?.(false);
        app.clearMessages();
        app.addMessage("system", `Context compacted: ${chatMsgs.length} messages -> ${compacted.length}`);
      } catch (err) {
        app.setCompacting?.(false);
        app.addMessage("system", `Compact failed: ${(err as Error).message}`);
      }
      return { handled: true };
    }
    case "budget":
      if (app.openBudgetView) app.openBudgetView("Budget Inspector", await loadBudgetReports(session), "all");
      else {
        const reports = await loadBudgetReports(session);
        app.addMessage("system", renderBudgetDashboard({ report: reports.all, scopeLabel: "all sessions", width: 100 }).join("\n"));
      }
      return { handled: true };
    case "update": {
      const update = await checkForNewVersion(APP_VERSION);
      if (!update) {
        app.addMessage("system", `Already on the latest brokecli (${APP_VERSION}).`);
        return { handled: true };
      }
      if (update.command && app.runExternalCommand) {
        const exitCode = app.runExternalCommand("Update brokecli", update.command.command, update.command.args);
        if (exitCode === 0) {
          app.clearUpdateNotice?.();
          app.addMessage("system", `Updated brokecli to v${update.latestVersion}. Restart to use the new version.`);
        } else {
          app.addMessage("system", `Update failed. ${update.instruction}`);
        }
        return { handled: true };
      }
      app.setUpdateNotice?.(update);
      app.addMessage("system", `Update available: v${update.latestVersion}. ${update.instruction}`);
      return { handled: true };
    }
    case "agents": {
      const runs = app.getAgentRuns?.() ?? [];
      if (runs.length === 0) {
        app.addMessage("system", "No delegated agent tasks yet.");
        return { handled: true };
      }
      app.openAgentRunsView?.("Agent Tasks", runs);
      return { handled: true };
    }
    case "fork": {
      const forked = session.fork();
      if (activeModel) forked.setProviderModel(activeModel.provider.name, currentModelId);
      onSessionReplace(forked);
      app.addMessage("system", "Forked session. History preserved, new branch started.");
      return { handled: true };
    }
    case "caveman": {
      app.cycleCavemanMode();
      reloadContext();
      const level = getSettings().cavemanLevel ?? "auto";
      onSystemPromptChange(buildSystemPrompt(process.cwd(), activeModel?.provider?.id, currentMode, level));
      return { handled: true };
    }
    case "thinking":
      app.cycleThinkingMode();
      return { handled: true };
    case "name": {
      const name = text.slice(6).trim();
      if (!name) {
        app.addMessage("system", "Usage: /name <session name>");
        return { handled: true };
      }
      session.setName(name);
      app.setSessionName?.(name);
      return { handled: true };
    }
    case "session": {
      const sessionDir = getSettings().sessionDir?.trim();
      const sessionFile = SessionManager.open(session.getId(), sessionDir || undefined, session.getCwd()).getSessionFile() ?? "in-memory";
      const items = [
        { id: "name", label: session.getName(), detail: "name" },
        { id: "id", label: session.getId(), detail: "id" },
        { id: "model", label: `${session.getProvider() || activeModel?.provider.name || "---"}/${session.getModel() || currentModelId || "none"}`, detail: "model" },
        { id: "cwd", label: session.getCwd(), detail: "directory" },
        { id: "file", label: sessionFile, detail: "session file" },
        { id: "created", label: formatRelativeMinutes(session.getCreatedAt()), detail: "created" },
        { id: "updated", label: formatRelativeMinutes(session.getUpdatedAt()), detail: "updated" },
        { id: "entries", label: String(session.getEntryCount()), detail: "entries" },
        { id: "path", label: String(session.getActivePathLength()), detail: "active path" },
        { id: "tokens", label: String(session.getTotalTokens()), detail: "total tokens" },
        { id: "input", label: String(session.getTotalInputTokens()), detail: "input tokens" },
        { id: "output", label: String(session.getTotalOutputTokens()), detail: "output tokens" },
        { id: "cost", label: session.getTotalCost().toFixed(6), detail: "session cost" },
        { id: "storage", label: getSettings().sessionDir?.trim() || "default", detail: "session dir" },
        { id: "persist", label: String(getSettings().autoSaveSessions), detail: "auto-save" },
      ];
      app.openItemPicker("Session", items, () => {}, { kind: "session" });
      return { handled: true };
    }
    case "hotkeys": {
      const bindings = loadKeybindings();
      const items = [
        { id: "submit", label: bindings.submit, detail: "send" },
        { id: "newline", label: bindings.newline, detail: "newline" },
        { id: "abort", label: bindings.abort, detail: "abort/exit" },
        { id: "modelPicker", label: bindings.modelPicker, detail: "model picker" },
        { id: "agentsView", label: bindings.agentsView, detail: "agent tasks" },
        { id: "toggleThinking", label: bindings.toggleThinking, detail: "thinking" },
        { id: "cycleScopedModel", label: bindings.cycleScopedModel, detail: "pinned models" },
        { id: "toggleMode", label: bindings.toggleMode, detail: "build/plan" },
        { id: "deleteWord", label: bindings.deleteWord, detail: "delete word" },
        { id: "deleteNextWord", label: bindings.deleteNextWord, detail: "delete next word" },
      ];
      app.openItemPicker("Hotkeys", items, () => {}, { kind: "hotkeys" });
      return { handled: true };
    }
    case "reload": {
      hooks.reload?.();
      reloadKeybindings();
      reloadContext();
      await refreshProviderState(true);
      return { handled: true };
    }
    case "changelog": {
      try {
        const raw = execSync("git log -n 8 --pretty=format:%h%x09%s", { encoding: "utf-8", cwd: process.cwd() }).trim();
        const items = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
          const [sha, ...rest] = line.split("\t");
          return { id: `${index}`, label: rest.join(" ").trim(), detail: sha };
        });
        if (items.length === 0) {
          app.addMessage("system", "No changelog entries found.");
        } else {
          app.openItemPicker("Recent Changes", items, () => {}, { kind: "hotkeys" });
        }
      } catch (err) {
        app.addMessage("system", `Changelog failed: ${(err as Error).message}`);
      }
      return { handled: true };
    }
    case "copy": {
      const lastContent = app.getLastAssistantContent();
      if (!lastContent) {
        app.addMessage("system", "No response to copy.");
        return { handled: true };
      }
      try {
        if (process.platform === "win32") execSync("clip", { input: lastContent });
        else if (process.platform === "darwin") execSync("pbcopy", { input: lastContent });
        else execSync("xclip -selection clipboard", { input: lastContent });
        app.addMessage("system", "Copied to clipboard.");
      } catch {
        app.addMessage("system", "Failed to copy to clipboard.");
      }
      return { handled: true };
    }
    case "export": {
      openExportMenu({ app, session, activeModel, currentModelId, text });
      return { handled: true };
    }
    case "share": {
      try {
        await shareTranscript({ app, session, activeModel, currentModelId });
      } catch (err) {
        app.addMessage("system", `Share failed: ${(err as Error).message}`);
      }
      return { handled: true };
    }
    case "sessions":
    case "resume": {
      openResumeMenu({ app, restText, onSessionReplace });
      return { handled: true };
    }
    case "projects": {
      openProjectsMenu(app, restText, onProjectChange);
      return { handled: true };
    }
    case "undo":
      app.addMessage("system", undoLastCheckpoint().message);
      return { handled: true };
    case "templates": {
      const templates = listTemplates();
      if (templates.length === 0) {
        app.addMessage("system", "No templates found. Add .md files to ~/.brokecli/prompts/ or .brokecli/prompts/");
        return { handled: true };
      }
      const lines = templates.map((template) => `  /${template.name}${template.description ? ` -- ${template.description}` : ""}`);
      app.addMessage("system", `Templates:\n${lines.join("\n")}`);
      return { handled: true };
    }
    case "skills": {
      const skills = listSkills();
      if (skills.length === 0) {
        app.addMessage("system", "No skills found.");
        return { handled: true };
      }
      const lines = skills.map((skill) => `  /skill:${skill.name}${skill.description ? ` -- ${skill.description}` : ""}`);
      app.addMessage("system", `Skills:\n${lines.join("\n")}`);
      return { handled: true };
    }
    case "logout": {
      await handleLogoutMenu({ app, restText, activeModel, refreshProviderState });
      return { handled: true };
    }
    case "quit":
    case "exit":
      app.stop();
      return { handled: true };
    default: {
      const skillName = cmd.startsWith("skill:") ? cmd.slice("skill:".length) : cmd;
      const template = loadTemplate(cmd);
      const skill = (cmd.startsWith("skill:") || getSettings().enableSkillCommands) ? loadSkillPrompt(skillName) : null;
      if (!template && !skill) {
        app.addMessage("system", `Unknown: /${cmd}`);
        return { handled: true };
      }
      let content = template ?? skill ?? "";
      const fileContexts = app.getFileContexts();
      if (fileContexts.size > 0) {
        const contextBlock = [...fileContexts.entries()]
          .map(([path, fc]) => `--- @${path} ---\n${fc}`)
          .join("\n\n");
        content = content.replace(/\{\{file\}\}/g, contextBlock);
      }
      const rest = text.slice(1 + cmd.length).trim();
      if (rest) content = `${content}\n\n${rest}`;
      app.addMessage("user", `/${cmd}${rest ? ` ${rest}` : ""}`);
      session.addMessage("user", content);
      return { handled: false, templateLoaded: true };
    }
  }
}
