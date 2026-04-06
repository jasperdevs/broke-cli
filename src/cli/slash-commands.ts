import { execSync } from "child_process";
import { writeFileSync } from "fs";
import type { ModelHandle } from "../ai/providers.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import { buildSystemPrompt, reloadContext } from "../core/context.js";
import { compactMessages, getTotalContextTokens } from "../core/compact.js";
import { clearCredentials, hasStoredCredentials, listAuthenticated } from "../core/auth.js";
import { getProviderCredential, getSettings, loadConfig, updateProviderConfig, updateSetting, type Settings, type Mode } from "../core/config.js";
import { listProjects } from "../core/projects.js";
import { listExtensions } from "../core/extensions.js";
import { isToolAllowed, toggleExtensionEnabled, toggleToolPermission } from "../core/permissions.js";
import { Session } from "../core/session.js";
import { listTemplates, loadTemplate } from "../core/templates.js";
import { undoLastCheckpoint } from "../core/git.js";
import { formatRelativeMinutes } from "./exports.js";
import { runConnectFlow } from "./connect-flow.js";
import { handleLogoutMenu, openExportMenu, openExtensionsMenu, openPermissionsMenu, openProjectsMenu, openResumeMenu, openSettingsMenu, openThemeMenu, shareTranscript } from "./slash-command-menus.js";
import type { ModelOption, SettingEntry, PickerItem } from "../tui/app-types.js";

interface SlashCommandApp {
  addMessage(role: "user" | "assistant" | "system", content: string): void;
  clearMessages(): void;
  resetCost(): void;
  setModel(provider: string, model: string): void;
  updateUsage(cost: number, inputTokens: number, outputTokens: number): void;
  openModelPicker(
    options: ModelOption[],
    onSelect: (providerId: string, modelId: string) => void,
    onPin?: (providerId: string, modelId: string, pinned: boolean) => void,
    initialCursor?: number,
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
      kind?: "permissions" | "extensions" | "theme" | "export" | "resume" | "projects" | "logout";
    },
  ): void;
  stop(): void;
  cycleCavemanMode(): void;
  cycleThinkingMode(): void;
  getLastAssistantContent(): string;
  getFileContexts(): Map<string, string>;
  showQuestion(prompt: string, options?: string[]): Promise<string>;
  updateItemPickerItems?(items: PickerItem[], focusId?: string): void;
  setCompacting?(compacting: boolean, tokenCount?: number): void;
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
    case "login":
      await runConnectFlow({
        app,
        providerRegistry,
        refreshProviderState,
        isSkippedPromptAnswer,
        isValidHttpBaseUrl,
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
        session.clear();
        for (const m of compacted) session.addMessage(m.role, m.content);
        app.setCompacting?.(false);
        app.clearMessages();
        app.addMessage("system", `Context compacted: ${chatMsgs.length} messages -> ${compacted.length}`);
      } catch (err) {
        app.setCompacting?.(false);
        app.addMessage("system", `Compact failed: ${(err as Error).message}`);
      }
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
      const level = getSettings().cavemanLevel ?? "off";
      app.addMessage("system", `🪨 ${level}`);
      onSystemPromptChange(buildSystemPrompt(process.cwd(), activeModel?.provider?.id, currentMode, level));
      return { handled: true };
    }
    case "thinking":
      app.cycleThinkingMode();
      app.addMessage("system", `Thinking: ${getSettings().thinkingLevel || (getSettings().enableThinking ? "low" : "off")}`);
      return { handled: true };
    case "name": {
      const name = text.slice(6).trim();
      app.addMessage("system", name ? `Session named: ${name}` : "Usage: /name <session name>");
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
    case "logout": {
      await handleLogoutMenu({ app, restText, activeModel, refreshProviderState });
      return { handled: true };
    }
    case "exit":
      app.stop();
      return { handled: true };
    default: {
      const template = loadTemplate(cmd);
      if (!template) {
        app.addMessage("system", `Unknown: /${cmd}`);
        return { handled: true };
      }
      let content = template;
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
