import { execSync } from "child_process";
import { listTemplates, loadTemplate } from "../core/templates.js";
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
import { loadKeybindings, reloadKeybindings } from "../core/keybindings.js";
import { reloadContext } from "../core/context.js";
import { undoLastCheckpoint } from "../core/git.js";
import type { ExtensionHooks, SlashCommandApp, SlashCommandResult } from "./slash-command-types.js";
import type { ModelHandle } from "../ai/providers.js";

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

export async function handleUiSlashCommand(options: {
  cmd: string;
  text: string;
  restText: string;
  app: SlashCommandApp;
  session: Session;
  activeModel: ModelHandle | null;
  currentModelId: string;
  refreshProviderState: (force?: boolean) => Promise<unknown>;
  onSessionReplace: (session: Session) => void;
  hooks: ExtensionHooks;
  onProjectChange: (cwd: string) => void;
}): Promise<SlashCommandResult | null> {
  const { cmd, text, restText, app, session, activeModel, currentModelId, refreshProviderState, onSessionReplace, hooks, onProjectChange } = options;

  switch (cmd) {
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
      app.setUpdateNotice?.(update);
      app.setStatus?.(`Update available: v${update.latestVersion}. ${update.instruction}`);
      return { handled: true };
    }
    case "tree":
      app.openTreeView?.("Session Tree", session, async (entryId: string) => {
        const target = session.getTreeEntry(entryId);
        if (!target) return;
        const abandoned = session.getEntriesToSummarizeForNavigation(entryId);
        let summaryText: string | undefined;
        let labelText: string | undefined;
        if (abandoned.length > 0) {
          const choice = await app.showQuestion("Branch switch", ["No summary", "Summarize", "Custom summary"]);
          if (choice === "Summarize" || choice === "Custom summary") {
            let custom = "";
            if (choice === "Custom summary") {
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
        { id: "treeView", label: bindings.treeView, detail: "session tree" },
        { id: "toggleThinking", label: bindings.toggleThinking, detail: "thinking" },
        { id: "cycleScopedModel", label: bindings.cycleScopedModel, detail: "pinned models" },
        { id: "toggleMode", label: bindings.toggleMode, detail: "build/plan" },
        { id: "deleteWord", label: bindings.deleteWord, detail: "delete word" },
        { id: "deleteNextWord", label: bindings.deleteNextWord, detail: "delete next word" },
      ];
      app.openItemPicker("Hotkeys", items, () => {}, { kind: "hotkeys" });
      return { handled: true };
    }
    case "reload":
      hooks.reload?.();
      reloadKeybindings();
      reloadContext();
      await refreshProviderState(true);
      return { handled: true };
    case "changelog": {
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
    }
    case "copy": {
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
    }
    case "export":
      openExportMenu({ app, session, activeModel, currentModelId, text });
      return { handled: true };
    case "sessions":
    case "resume":
      openResumeMenu({ app, restText, onSessionReplace });
      return { handled: true };
    case "projects":
      openProjectsMenu(app, restText, onProjectChange);
      return { handled: true };
    case "undo":
      app.setStatus?.(undoLastCheckpoint().message);
      return { handled: true };
    case "templates": {
      const templates = listTemplates();
      if (templates.length === 0) {
        openEmptyItemMenu(app, "Templates", "add .md files to ~/.brokecli/prompts or .brokecli/prompts", "templates");
        return { handled: true };
      }
      const items = templates.map((template) => ({
        id: template.name,
        label: `/${template.name}`,
        detail: template.description || "prompt template",
      }));
      app.openItemPicker("Templates", items, (id: string) => {
        app.setDraft?.(`/${id} `);
      }, { kind: "templates" });
      return { handled: true };
    }
    case "skills": {
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
    }
    case "logout":
      await handleLogoutMenu({ app, restText, activeModel, refreshProviderState });
      return { handled: true };
    case "quit":
    case "exit":
      app.stop();
      return { handled: true };
    default: {
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
}
