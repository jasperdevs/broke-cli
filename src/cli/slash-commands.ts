import { execSync } from "child_process";
import { writeFileSync } from "fs";
import type { ModelHandle } from "../ai/providers.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import { buildSystemPrompt, reloadContext } from "../core/context.js";
import { compactMessages, getTotalContextTokens } from "../core/compact.js";
import { clearCredentials, hasStoredCredentials, listAuthenticated } from "../core/auth.js";
import { getProviderCredential, getSettings, loadConfig, updateProviderConfig, updateSetting, type Settings, type Mode } from "../core/config.js";
import { buildRepoMap, formatRepoMap } from "../core/repo-map.js";
import { listProjects } from "../core/projects.js";
import { listExtensions } from "../core/extensions.js";
import { isExtensionEnabled, isToolAllowed, toggleExtensionEnabled, toggleToolPermission } from "../core/permissions.js";
import { Session } from "../core/session.js";
import { listTemplates, loadTemplate } from "../core/templates.js";
import { undoLastCheckpoint } from "../core/git.js";
import { listThemes, setPreviewTheme } from "../core/themes.js";
import { buildHtmlExport, buildMarkdownExport, formatRelativeMinutes } from "./exports.js";
import { runConnectFlow } from "./connect-flow.js";
import { TOOL_NAMES } from "../tools/registry.js";

interface ModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  active: boolean;
}

interface SettingEntry {
  key: string;
  label: string;
  value: string;
  description: string;
}

interface PickerItem {
  id: string;
  label: string;
  detail?: string;
}

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

function listLogoutTargets(): string[] {
  const configuredProviders = Object.entries(loadConfig().providers ?? {})
    .filter(([, entry]) => !!entry?.apiKey)
    .map(([provider]) => provider);
  return [...new Set([...configuredProviders, ...listAuthenticated()])].sort();
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
      function buildEntries(): SettingEntry[] {
        const s = getSettings();
        const followUpLabels: Record<string, string> = {
          immediate: "send now",
          after_tool: "after tool",
          after_response: "after response",
        };
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
          { key: "followUpMode", label: "Follow-up mode", value: followUpLabels[s.followUpMode] ?? s.followUpMode, description: "When to send queued messages while AI is working" },
          { key: "notifyOnResponse", label: "Notify on response", value: String(s.notifyOnResponse), description: "Show a desktop notification when a response completes" },
          { key: "theme", label: "Theme", value: s.theme, description: "Switch the full terminal color theme" },
          { key: "cavemanLevel", label: "Caveman mode", value: s.cavemanLevel ?? "off", description: "off / lite / auto / ultra — save output tokens (ctrl+y)" },
          { key: "architectMode", label: "Architect/editor", value: String(s.architectMode), description: "Use current model to plan edits before the editor model applies them" },
          { key: "editorModel", label: "Editor model", value: s.editorModel || "off", description: "Model used for file-edit execution when architect/editor mode is on" },
          { key: "autoLint", label: "Auto lint", value: String(s.autoLint), description: `Run ${s.lintCommand || "lint"} after model edits` },
          { key: "autoTest", label: "Auto test", value: String(s.autoTest), description: `Run ${s.testCommand || "tests"} after model edits` },
          { key: "autoFixValidation", label: "Auto-fix validation", value: String(s.autoFixValidation), description: "Send one automatic repair turn when lint/test fails" },
        ];
      }

      app.openSettings(buildEntries(), (key) => {
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
        } else if (key === "followUpMode") {
          const modes: Array<"immediate" | "after_tool" | "after_response"> = ["immediate", "after_tool", "after_response"];
          updateSetting("followUpMode", modes[(modes.indexOf(s.followUpMode) + 1) % modes.length]);
        } else if (key === "theme") {
          const themes = listThemes();
          const currentIdx = Math.max(0, themes.findIndex((theme) => theme.key === s.theme));
          updateSetting("theme", themes[(currentIdx + 1) % themes.length].key);
        } else if (key === "cavemanLevel") {
          const levels = ["off", "lite", "auto", "ultra"] as const;
          const current = s.cavemanLevel ?? "off";
          const next = levels[(levels.indexOf(current as any) + 1) % levels.length];
          updateSetting("cavemanLevel", next);
          reloadContext();
          onSystemPromptChange(buildSystemPrompt(process.cwd(), activeModel?.provider?.id, currentMode, next));
        } else if (key === "editorModel") {
          const options = buildVisibleModelOptions();
          const items = options.map((option) => ({
            id: `${option.providerId}/${option.modelId}`,
            label: `${option.providerName}/${option.modelId}`,
            detail: option.active ? "pinned" : undefined,
          }));
          items.unshift({ id: "", label: "off", detail: "use the main model for editing" });
          app.openItemPicker("Editor model", items, (value) => {
            updateSetting("editorModel", value);
            app.updateSettings(buildEntries());
          });
          return;
        }
        app.updateSettings(buildEntries());
      });
      return { handled: true };
    }
    case "repomap": {
      const entries = buildRepoMap({ query: restText, maxFiles: 24, maxLinesPerFile: 6 });
      if (entries.length === 0) {
        app.addMessage("system", "Repo map is empty for this project.");
        return { handled: true };
      }
      app.addMessage("system", formatRepoMap(entries));
      return { handled: true };
    }
    case "editor": {
      const options = buildVisibleModelOptions();
      if (options.length === 0) {
        app.addMessage("system", "No models available. Run /connect.");
        return { handled: true };
      }
      const items = options.map((option) => ({
        id: `${option.providerId}/${option.modelId}`,
        label: `${option.providerName}/${option.modelId}`,
        detail: option.active ? "pinned" : undefined,
      }));
      items.unshift({ id: "", label: "off", detail: "disable architect/editor split" });
      const current = getSettings().editorModel;
      const initialCursor = Math.max(0, items.findIndex((item) => item.id === current));
      app.openItemPicker("Editor model", items, (value) => {
        updateSetting("editorModel", value);
        app.addMessage("system", value ? `Editor model set: ${value}` : "Editor model off.");
      }, { initialCursor });
      return { handled: true };
    }
    case "permissions": {
      const items = TOOL_NAMES.map((name) => ({
        id: name,
        label: name,
        detail: isToolAllowed(name) ? "allowed" : "blocked",
      }));
      app.openItemPicker("Tool permissions", items, (id) => {
        const denied = toggleToolPermission(id);
        app.addMessage("system", `${id}: ${denied ? "blocked" : "allowed"}`);
      }, {
        secondaryHint: "tab toggles allow/block",
        onSecondaryAction: (id) => {
          toggleToolPermission(id);
          const nextItems = TOOL_NAMES.map((name) => ({
            id: name,
            label: name,
            detail: isToolAllowed(name) ? "allowed" : "blocked",
          }));
          app.updateItemPickerItems?.(nextItems, id);
        },
      });
      return { handled: true };
    }
    case "extensions": {
      const extensions = listExtensions();
      if (extensions.length === 0) {
        app.addMessage("system", "No extensions found in ~/.brokecli/extensions.");
        return { handled: true };
      }
      const items = extensions.map((entry) => ({
        id: entry.id,
        label: entry.id,
        detail: entry.enabled ? "enabled" : "disabled",
      }));
      app.openItemPicker("Extensions", items, (id) => {
        const enabled = toggleExtensionEnabled(id);
        hooks.reload?.();
        app.addMessage("system", `${id}: ${enabled ? "enabled" : "disabled"}`);
      }, {
        secondaryHint: "tab toggles enable/disable",
        onSecondaryAction: (id) => {
          toggleExtensionEnabled(id);
          hooks.reload?.();
          const nextItems = listExtensions().map((entry) => ({
            id: entry.id,
            label: entry.id,
            detail: isExtensionEnabled(entry.id) ? "enabled" : "disabled",
          }));
          app.updateItemPickerItems?.(nextItems, id);
        },
      });
      return { handled: true };
    }
    case "theme": {
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
      app.openItemPicker("Theme", themeItems, (themeId) => {
        setPreviewTheme(null);
        updateSetting("theme", themeId);
      }, {
        initialCursor: currentIdx,
        previewHint: "previewing highlighted theme · enter keeps it · esc goes back",
        secondaryHint: "tab stars theme",
        onPreview: (themeId) => setPreviewTheme(themeId),
        onCancel: () => setPreviewTheme(null),
        onSecondaryAction: (themeId) => {
          const currentFavorites = getSettings().favoriteThemes ?? [];
          const nextFavorites = currentFavorites.includes(themeId)
            ? currentFavorites.filter((id) => id !== themeId)
            : [...currentFavorites, themeId];
          updateSetting("favoriteThemes", nextFavorites);
          app.updateItemPickerItems?.(buildThemeItems(), themeId);
        },
      });
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
      const items = [
        { id: "markdown", label: "Markdown", detail: ".md file format" },
        { id: "html", label: "HTML", detail: "standalone HTML file" },
        { id: "copy-markdown", label: "Copy Markdown", detail: "copy full transcript" },
      ];
      app.openItemPicker("Export format", items, (id) => {
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
      });
      return { handled: true };
    }
    case "sessions":
    case "resume": {
      const cwd = process.cwd();
      const recent = Session.listRecent(20, restText, cwd);
      if (recent.length === 0) {
        app.addMessage("system", "No sessions for this directory.");
        return { handled: true };
      }
      const items = recent.map((entry) => ({
        id: entry.id,
        label: entry.preview || entry.model || "unknown",
        detail: `${entry.model || "unknown"} · ${entry.messageCount} msgs · ${formatRelativeMinutes(entry.updatedAt)}`,
      }));
      app.openItemPicker("Resume Session", items, (sessionId) => {
        const loaded = Session.load(sessionId);
        if (!loaded) return;
        onSessionReplace(loaded);
        app.clearMessages();
        for (const msg of loaded.getMessages()) app.addMessage(msg.role, msg.content);
        app.updateUsage(loaded.getTotalCost(), loaded.getTotalInputTokens(), loaded.getTotalOutputTokens());
        app.addMessage("system", "Session resumed.");
      });
      return { handled: true };
    }
    case "projects": {
      const projects = listProjects(20, restText);
      if (projects.length === 0) {
        app.addMessage("system", "No saved projects yet.");
        return { handled: true };
      }
      const items = projects.map((entry) => ({
        id: entry.cwd,
        label: entry.cwd,
        detail: `${entry.lastInstruction.slice(0, 60)} · ${formatRelativeMinutes(entry.lastAccessed)}`,
      }));
      app.openItemPicker("Projects", items, (cwd) => {
        onProjectChange(cwd);
        app.addMessage("system", `Switched project: ${cwd}`);
      });
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
      const executeLogout = async (requestedTarget: string) => {
        const normalized = requestedTarget.trim().toLowerCase();
        const knownTargets = listLogoutTargets();
        const targets = normalized === "all"
          ? knownTargets
          : normalized
            ? [normalized]
            : [];

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
          if (hasStoredConfigKey) {
            updateProviderConfig(provider, { apiKey: null });
          }

          if (credential.kind === "api_key" && (credential.source === "config" || credential.source === undefined)) {
            cleared.push(provider);
            continue;
          }

          if (credential.kind !== "none" && credential.source && credential.source !== "config") {
            external.push(`${provider} (${credential.source})`);
            continue;
          }

          if (hasStoredConfigKey || hadStoredAuth) {
            cleared.push(provider);
          }
        }

        if (normalized === "all" || (activeModel && targets.includes(activeModel.provider.id))) {
          updateSetting("lastModel", "");
        }

        await refreshProviderState(true);

        if (cleared.length > 0) {
          app.addMessage("system", `Cleared stored brokecli auth for: ${cleared.join(", ")}`);
        }
        if (external.length > 0) {
          app.addMessage("system", `External env/native auth still active: ${external.join(", ")}`);
        }
        if (cleared.length === 0 && external.length === 0) {
          app.addMessage("system", "No stored brokecli credentials found to clear.");
        }
      };

      if (restText) {
        await executeLogout(restText);
        return { handled: true };
      }

      const targets = listLogoutTargets();
      if (targets.length === 0) {
        app.addMessage("system", "No stored brokecli credentials found to clear.");
        return { handled: true };
      }

      const items = [
        { id: "all", label: "all", detail: `clear ${targets.length} stored provider entr${targets.length === 1 ? "y" : "ies"}` },
        ...targets.map((provider) => {
          const credential = getProviderCredential(provider);
          return {
            id: provider,
            label: provider,
            detail: credential.source ?? "stored auth",
          };
        }),
      ];
      app.openItemPicker("Logout", items, (id) => {
        void executeLogout(id);
      });
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
