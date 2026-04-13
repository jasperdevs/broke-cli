import { execSync } from "child_process";
import { SessionManager } from "../core/session-manager.js";
import { Session } from "../core/session.js";
import { getSettings } from "../core/config.js";
import type { ModelHandle } from "../ai/providers.js";
import type { SlashCommandApp } from "./slash-command-types.js";
import { formatRelativeMinutes } from "./exports.js";

function copyToClipboard(text: string): void {
  if (process.platform === "win32") execSync("clip", { input: text });
  else if (process.platform === "darwin") execSync("pbcopy", { input: text });
  else execSync("xclip -selection clipboard", { input: text });
}

export function openSessionMenu(args: {
  app: SlashCommandApp;
  session: Session;
  activeModel: ModelHandle | null;
  currentModelId: string;
  onSessionReplace: (session: Session) => void;
}): void {
  const { app, session, activeModel, currentModelId, onSessionReplace } = args;
  const sessionDir = getSettings().sessionDir?.trim();
  const sessionFile = SessionManager.open(session.getId(), sessionDir || undefined, session.getCwd()).getSessionFile() ?? "in-memory";
  const items = [
    { id: "__tree__", label: "Open session tree", detail: "browse branches, labels, and forks" },
    { id: "__rename__", label: "Rename session", detail: session.getName() },
    { id: "__copy_id__", label: "Copy session id", detail: session.getId() },
    { id: "__copy_file__", label: "Copy session file", detail: sessionFile },
    { id: "__delete__", label: "Delete session", detail: "remove the persisted session and clear the current thread", tone: "danger" as const },
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

  app.openItemPicker("Session", items, (id: string) => {
    if (id === "__tree__") {
      app.setDraft?.("/tree");
      app.setStatus?.("Drafted /tree.");
      return;
    }
    if (id === "__rename__") {
      void app.showQuestion("Session name", [session.getName()]).then((value: string) => {
        const next = value.trim();
        if (!next) {
          app.setStatus?.("Session rename cancelled.");
          return;
        }
        session.setName(next);
        app.setSessionName?.(next);
        app.setStatus?.(`Session renamed to ${next}.`);
      });
      return;
    }
    if (id === "__copy_id__" || id === "__copy_file__") {
      const value = id === "__copy_id__" ? session.getId() : sessionFile;
      try {
        copyToClipboard(value);
        app.setStatus?.(`${id === "__copy_id__" ? "Session id" : "Session file"} copied.`);
      } catch (error) {
        app.setStatus?.(`Copy failed: ${(error as Error).message}`);
      }
      return;
    }
    if (id !== "__delete__") {
      const selected = items.find((item) => item.id === id);
      if (!selected) return;
      try {
        copyToClipboard(selected.label);
        app.setStatus?.(`${selected.detail ?? "value"} copied.`);
      } catch (error) {
        app.setStatus?.(`Copy failed: ${(error as Error).message}`);
      }
      return;
    }
    void app.showQuestion("Type DELETE to remove this session").then((value: string) => {
      if (value.trim() !== "DELETE") {
        app.setStatus?.("Session delete cancelled.");
        return;
      }
      SessionManager.open(session.getId(), sessionDir || undefined, session.getCwd()).deleteCurrentSession();
      const fresh = new Session();
      fresh.setCwd(session.getCwd());
      if (activeModel) fresh.setProviderModel(activeModel.provider.name, currentModelId || activeModel.modelId);
      onSessionReplace(fresh);
      app.clearMessages();
      app.updateUsage(0, 0, 0);
      app.setSessionName?.(fresh.getName());
      app.setStatus?.("Deleted persisted session and started a fresh thread.");
    });
  }, { kind: "session", closeOnSelect: false });
}
