import { execSync } from "child_process";
import { createTemplate, listTemplates, loadTemplate } from "../core/templates.js";
import { listSkills, loadSkillPrompt } from "../core/skills.js";
import { SessionManager } from "../core/session-manager.js";
import { Session } from "../core/session.js";
import { getSettings } from "../core/config.js";
import { buildAggregateBudgetReport, buildBudgetReport, renderBudgetDashboard, type BudgetReport } from "../core/budget-insights.js";
import { formatRelativeMinutes } from "./exports.js";
import { summarizeBranchMessages } from "../core/compact.js";
import { checkForNewVersion } from "../core/update.js";
import { APP_VERSION } from "../core/app-meta.js";
import { handleLogoutMenu, openEmptyItemMenu, openExportMenu, openProjectsMenu, openResumeMenu } from "./slash-command-menus.js";
import { formatKeypressBinding, loadKeybindings, reloadKeybindings, updateKeybinding, type Keybindings } from "../core/keybindings.js";
import { reloadContext } from "../core/context.js";
import { undoLastCheckpoint } from "../core/git.js";
import { createSlashCommandRegistry } from "./slash-command-registry.js";
import type { ParsedSlashCommand, SlashCommandApp, SlashCommandResult } from "./slash-command-types.js";
import type { ModelHandle } from "../ai/providers.js";
import type { PickerItem } from "../tui/app-types.js";

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

function reloadSessionIntoUi(app: SlashCommandApp, session: Session, editorText?: string): void {
  app.clearMessages();
  for (const msg of session.getMessages()) app.addMessage(msg.role, msg.content);
  app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
  if (editorText) app.setDraft?.(editorText);
}

async function chooseMenuItem(
  app: SlashCommandApp,
  title: string,
  items: PickerItem[],
  kind: "tree" | "hotkeys" | "name",
): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    app.openItemPicker(title, items, (id: string) => finish(id), {
      kind,
      onCancel: () => finish(""),
    });
  });
}

function getHotkeyLabels(bindings: Keybindings): Array<{ id: keyof Keybindings; label: string; detail: string }> {
  return [
    { id: "submit", label: "Send message", detail: bindings.submit },
    { id: "newline", label: "Insert newline", detail: bindings.newline },
    { id: "abort", label: "Abort / exit", detail: bindings.abort },
    { id: "modelPicker", label: "Open model menu", detail: bindings.modelPicker },
    { id: "toggleThinking", label: "Cycle thinking", detail: bindings.toggleThinking },
    { id: "cycleScopedModel", label: "Cycle pinned model", detail: bindings.cycleScopedModel },
    { id: "toggleMode", label: "Toggle build / plan", detail: bindings.toggleMode },
    { id: "deleteWord", label: "Delete word", detail: bindings.deleteWord },
    { id: "deleteNextWord", label: "Delete next word", detail: bindings.deleteNextWord },
  ];
}

interface UiSlashCommandContext extends ParsedSlashCommand {}

const uiSlashCommands = createSlashCommandRegistry<UiSlashCommandContext, SlashCommandResult>([
  {
    names: ["budget"],
    run: async ({ app, session }) => {
      if (app.openBudgetView) app.openBudgetView("Budget Inspector", await loadBudgetReports(session), "all");
      else {
        const reports = await loadBudgetReports(session);
        app.addMessage("system", renderBudgetDashboard({ report: reports.all, scopeLabel: "all sessions", width: 100 }).join("\n"));
      }
      return { handled: true };
    },
  },
  {
    names: ["update"],
    run: async ({ app }) => {
      const update = await checkForNewVersion(APP_VERSION);
      if (!update) {
        app.clearUpdateNotice?.();
        app.setStatus?.(`Already on the latest version (${APP_VERSION}).`);
        return { handled: true };
      }
      if (update.command && app.runExternalCommand) {
        const exitCode = app.runExternalCommand("Update", update.command.command, update.command.args);
        if (exitCode === 0) {
          app.clearUpdateNotice?.();
          app.setStatus?.(`Updated to v${update.latestVersion}. Restart to use the new version.`);
        } else {
          app.setStatus?.(`Update failed. ${update.instruction}`);
        }
        return { handled: true };
      }
      app.clearUpdateNotice?.();
      const instruction = update.command ? `Run /update to install ${update.latestVersion}.` : update.instruction;
      app.setStatus?.(`Update available: v${update.latestVersion}. ${instruction}`);
      return { handled: true };
    },
  },
  {
    names: ["tree"],
    run: ({ app, session, activeModel }) => {
      app.openTreeView?.("Session Tree", session, async (entryId: string) => {
        const target = session.getTreeEntry(entryId);
        if (!target) return;
        const abandoned = session.getEntriesToSummarizeForNavigation(entryId);
        let summaryText: string | undefined;
        let labelText: string | undefined;
        if (abandoned.length > 0) {
          const choice = await chooseMenuItem(app, "Branch switch", [
            { id: "skip", label: "Jump now", detail: "switch branches without a summary" },
            { id: "summarize", label: "Summarize branch", detail: "save abandoned branch context" },
            { id: "custom", label: "Custom summary", detail: "choose the summary focus first" },
          ], "tree");
          if (choice === "summarize" || choice === "custom") {
            let custom = "";
            if (choice === "custom") {
              custom = (await app.showQuestion("Custom summary focus"))?.trim?.() || "";
            }
            app.setCompacting?.(true);
            summaryText = await summarizeBranchMessages(
              abandoned.map((entry) => ({ role: entry.role === "system" ? "assistant" : entry.role, content: entry.content })),
              activeModel?.runtime === "sdk" ? activeModel.model ?? undefined : undefined,
              custom || undefined,
            );
            app.setCompacting?.(false);
            labelText = custom ? "branch summary" : undefined;
          }
        }
        const result = session.navigateTree(entryId, { summary: summaryText, label: labelText });
        reloadSessionIntoUi(app, session, result.editorText);
      });
      return { handled: true };
    },
  },
  {
    names: ["session"],
    run: ({ app, session, activeModel, currentModelId }) => {
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
    },
  },
  {
    names: ["hotkeys"],
    run: ({ app }) => {
      let bindings = loadKeybindings();
      let rebinding: keyof Keybindings | null = null;
      const buildItems = () => [
        ...getHotkeyLabels(bindings).map((entry) => ({
          id: entry.id,
          label: entry.label,
          detail: rebinding === entry.id
            ? "press shortcut · enter stop · backspace clear"
            : entry.detail,
        })),
        {
          id: "__reset__",
          label: "Reset hotkeys",
          detail: "restore defaults and clear custom bindings",
          tone: "danger" as const,
        },
      ];
      app.openItemPicker("Hotkeys", buildItems(), (id: string) => {
        if (id === "__reset__") {
          for (const entry of getHotkeyLabels(bindings)) updateKeybinding(entry.id, "");
          reloadKeybindings();
          bindings = loadKeybindings();
          rebinding = null;
          app.updateItemPickerItems?.(buildItems(), "__reset__");
          app.setStatus?.("Reset custom hotkeys.");
          return;
        }
        const key = id as keyof Keybindings;
        rebinding = rebinding === key ? null : key;
        app.updateItemPickerItems?.(buildItems(), id);
        app.setStatus?.(rebinding ? `Rebinding ${getHotkeyLabels(bindings).find((entry) => entry.id === key)?.label ?? key}. Press a shortcut, Enter to stop, Backspace to clear.` : "Stopped rebinding.");
      }, {
        kind: "hotkeys",
        closeOnSelect: false,
        onCancel: () => { rebinding = null; },
        onKey: (key) => {
          if (!rebinding) return false;
          if (key.name === "escape") {
            rebinding = null;
            app.updateItemPickerItems?.(buildItems());
            app.setStatus?.("Stopped rebinding.");
            return true;
          }
          if ((key.name === "return" || key.name === "enter") && !key.ctrl && !key.meta && !key.shift) {
            rebinding = null;
            app.updateItemPickerItems?.(buildItems());
            app.setStatus?.("Stopped rebinding.");
            return true;
          }
          if (key.name === "backspace" && !key.ctrl && !key.meta && !key.shift) {
            updateKeybinding(rebinding, "");
            reloadKeybindings();
            bindings = loadKeybindings();
            const cleared = rebinding;
            rebinding = null;
            app.updateItemPickerItems?.(buildItems(), cleared);
            app.setStatus?.(`Cleared ${getHotkeyLabels(bindings).find((entry) => entry.id === cleared)?.label ?? cleared}.`);
            return true;
          }
          const binding = formatKeypressBinding(key);
          if (!binding) return true;
          updateKeybinding(rebinding, binding);
          reloadKeybindings();
          bindings = loadKeybindings();
          const assigned = rebinding;
          rebinding = null;
          app.updateItemPickerItems?.(buildItems(), assigned);
          app.setStatus?.(`${getHotkeyLabels(bindings).find((entry) => entry.id === assigned)?.label ?? assigned} set to ${binding}.`);
          return true;
        },
      });
      return { handled: true };
    },
  },
  {
    names: ["reload"],
    run: async ({ hooks, refreshProviderState }) => {
      hooks.reload?.();
      reloadKeybindings();
      reloadContext();
      await refreshProviderState(true);
      return { handled: true };
    },
  },
  {
    names: ["changelog"],
    run: ({ app }) => {
      try {
        const raw = execSync("git log -n 8 --pretty=format:%h%x09%s", { encoding: "utf-8", cwd: process.cwd() }).trim();
        const items = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
          const [sha, ...rest] = line.split("\t");
          return { id: `${index}`, label: rest.join(" ").trim(), detail: sha };
        });
        if (items.length === 0) openEmptyItemMenu(app, "Recent Changes", "no changelog entries yet", "changelog");
        else app.openItemPicker("Recent Changes", items, () => {}, { kind: "changelog" });
      } catch (err) {
        app.setStatus?.(`Changelog failed: ${(err as Error).message}`);
      }
      return { handled: true };
    },
  },
  {
    names: ["copy"],
    run: ({ app }) => {
      const lastContent = app.getLastAssistantContent();
      if (!lastContent) {
        app.setStatus?.("No response to copy.");
        return { handled: true };
      }
      try {
        if (process.platform === "win32") execSync("clip", { input: lastContent });
        else if (process.platform === "darwin") execSync("pbcopy", { input: lastContent });
        else execSync("xclip -selection clipboard", { input: lastContent });
        app.setStatus?.("Copied to clipboard.");
      } catch {
        app.setStatus?.("Failed to copy to clipboard.");
      }
      return { handled: true };
    },
  },
  {
    names: ["export"],
    run: ({ app, session, activeModel, currentModelId, text }) => {
      openExportMenu({ app, session, activeModel, currentModelId, text });
      return { handled: true };
    },
  },
  {
    names: ["sessions", "resume"],
    run: ({ app, restText, onSessionReplace }) => {
      openResumeMenu({ app, restText, onSessionReplace });
      return { handled: true };
    },
  },
  {
    names: ["projects"],
    run: ({ app, restText, onProjectChange }) => {
      openProjectsMenu(app, restText, onProjectChange);
      return { handled: true };
    },
  },
  {
    names: ["undo"],
    run: ({ app }) => {
      app.setStatus?.(undoLastCheckpoint().message);
      return { handled: true };
    },
  },
  {
    names: ["templates"],
    run: ({ app }) => {
      const templates = listTemplates();
      const items = [
        { id: "__create__", label: "Create template", detail: "make a new slash template now" },
        ...templates.map((template) => ({
        id: template.name,
        label: `/${template.name}`,
        detail: template.description || "prompt template",
        })),
      ];
      app.openItemPicker("Templates", items, async (id: string) => {
        if (id === "__create__") {
          const rawName = await app.showQuestion("Template name");
          const name = rawName?.trim();
          if (!name) {
            app.setStatus?.("Template creation cancelled.");
            return;
          }
          try {
            createTemplate(name);
            app.setStatus?.(`Created template /${name}.`);
            app.setDraft?.(`/${name} `);
          } catch (error) {
            app.setStatus?.(`Template create failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          return;
        }
        app.setDraft?.(`/${id} `);
      }, { kind: "templates" });
      return { handled: true };
    },
  },
  {
    names: ["skills"],
    run: ({ app }) => {
      const skills = listSkills();
      if (skills.length === 0) {
        openEmptyItemMenu(app, "Skills", "no skills available", "skills");
        return { handled: true };
      }
      const items = skills.map((skill) => ({
        id: skill.name,
        label: `/skill:${skill.name}`,
        detail: skill.description || "skill prompt",
      }));
      app.openItemPicker("Skills", items, (id: string) => {
        app.setDraft?.(`/skill:${id} `);
      }, { kind: "skills" });
      return { handled: true };
    },
  },
  {
    names: ["logout"],
    run: async ({ app, restText, activeModel, refreshProviderState }) => {
      await handleLogoutMenu({ app, restText, activeModel, refreshProviderState });
      return { handled: true };
    },
  },
  {
    names: ["quit", "exit"],
    run: ({ app }) => {
      app.stop();
      return { handled: true };
    },
  },
]);

export async function handleUiSlashCommand(options: UiSlashCommandContext): Promise<SlashCommandResult | null> {
  const { cmd, text, app, session } = options;
  const command = uiSlashCommands.get(cmd);
  if (command) return await command(options);
  {
      const skillName = cmd.startsWith("skill:") ? cmd.slice("skill:".length) : cmd;
      const template = loadTemplate(cmd);
      const skill = (cmd.startsWith("skill:") || getSettings().enableSkillCommands) ? loadSkillPrompt(skillName) : null;
      if (!template && !skill) return null;
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
