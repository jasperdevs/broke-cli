import { Command } from "commander";
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { App } from "../src/tui/app.js";
import type { DetectedProvider } from "../src/ai/detect.js";
import type { ModelHandle } from "../src/ai/providers.js";
import { buildSystemPrompt, reloadContext } from "../src/core/context.js";
import { Session } from "../src/core/session.js";
import { getTools } from "../src/tools/registry.js";
import { createAskUserTool } from "../src/tools/ask.js";
import { setBashOutputCallback } from "../src/tools/bash.js";
import { setTodoChangeCallback } from "../src/tools/todo.js";
import { getApiKey, getSettings, updateSetting, type Settings, type Mode } from "../src/core/config.js";
import { compactMessages, getTotalContextTokens } from "../src/core/compact.js";
import { undoLastCheckpoint } from "../src/core/git.js";
import { listTemplates, loadTemplate } from "../src/core/templates.js";
import { loadExtensions } from "../src/core/extensions.js";
import { RESET, DIM, GREEN } from "../src/utils/ansi.js";
import { listThemes, setPreviewTheme } from "../src/core/themes.js";
import { ProviderRegistry } from "../src/ai/provider-registry.js";
import { runRpcMode } from "../src/cli/rpc.js";
import { buildHtmlExport, buildMarkdownExport, formatRelativeMinutes } from "../src/cli/exports.js";
import { runConnectFlow } from "../src/cli/connect-flow.js";
import { bootstrapSession } from "../src/cli/session-bootstrap.js";
import { runModelTurn } from "../src/cli/turn-runner.js";

const program = new Command()
  .name("brokecli")
  .description("AI coding CLI that doesn't waste your money")
  .version("0.0.1")
  .option("--broke", "Route to cheapest capable model")
  .option("-m, --model <model>", "Model to use (provider/model-id)")
  .option("-c, --continue", "Continue last session")
  .option("-p, --print", "Single-shot mode: print response and exit")
  .option("--rpc", "Non-interactive JSON RPC mode");

function isSkippedPromptAnswer(value: string | undefined | null): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "[user skipped]" || normalized === "[no answer]";
}

function isValidHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.host;
  } catch {
    return false;
  }
}


program.action(async (opts) => {
  // Load extension hooks
  const hooks = loadExtensions();

  // RPC mode � non-interactive JSON I/O
  if (opts.rpc) {
    await runRpcMode(hooks, opts);
    return;
  }

  const app = new App();
  app.setVersion(program.version() ?? "0.0.1");
  let currentMode: Mode = "build";
  let systemPrompt = buildSystemPrompt(process.cwd(), undefined, currentMode, getSettings().cavemanLevel ?? "off");
  let lastActivityTime = Date.now(); // Track for cache expiry warning

  // Resume or new session
  let session: Session;
  if (opts.continue) {
    const recent = Session.listRecent(1);
    if (recent.length > 0) {
      const loaded = Session.load(recent[0].id);
      session = loaded ?? new Session();
      if (loaded) {
        // Replay messages into UI
        for (const msg of loaded.getMessages()) {
          app.addMessage(msg.role, msg.content);
        }
      }
    } else {
      session = new Session();
    }
  } else {
    session = new Session();
  }
  const getContextOptimizer = (): ReturnType<Session["getContextOptimizer"]> => session.getContextOptimizer();

  app.start();
  hooks.emit("on_session_start", { cwd: process.cwd() });
  app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
  const providerRegistry = new ProviderRegistry();

  // Scoped model index for Ctrl+P cycling
  let scopedModelIndex = -1;

  // Mode toggle callback
  app.onModeToggle((newMode) => {
    currentMode = newMode;
    const activeProvider = activeModel?.provider?.id;
    const caveman = getSettings().cavemanLevel ?? "off";
    systemPrompt = buildSystemPrompt(process.cwd(), activeProvider, currentMode, caveman);
  });

  app.onCavemanToggle((level) => {
    const activeProvider = activeModel?.provider?.id;
    reloadContext();
    systemPrompt = buildSystemPrompt(process.cwd(), activeProvider, currentMode, level);
  });

  app.onScopedModelCycle(() => {
    const scoped = getSettings().scopedModels;
    if (scoped.length === 0) {
      app.setStatus("No pinned models. Use /model and press space to pin.");
      setTimeout(() => app.clearStatus(), 2000);
      return;
    }
    scopedModelIndex = (scopedModelIndex + 1) % scoped.length;
    const entry = scoped[scopedModelIndex];
    const slashIdx = entry.indexOf("/");
    if (slashIdx > 0) {
      const provId = entry.slice(0, slashIdx);
      const modId = entry.slice(slashIdx + 1);
      try {
        activeModel = providerRegistry.createModel(provId, modId);
        currentModelId = modId;
        systemPrompt = buildSystemPrompt(process.cwd(), provId, currentMode, getSettings().cavemanLevel ?? "off");
        app.setModel(activeModel.provider.name, currentModelId);
        session.setProviderModel(activeModel.provider.name, currentModelId);
        updateSetting("lastModel", entry);
      } catch (err) {
        app.addMessage("system", `Failed to switch: ${(err as Error).message}`);
      }
    }
  });

  // Detect providers + load pricing in background
  let providers: DetectedProvider[] = [];
  let activeModel: ModelHandle | null = null;
  let smallModel: ModelHandle | null = null;
  let currentModelId = "";
  let smallModelId = "";
  let lastToolCalls: string[] = [];

  async function refreshProviderState(force = false): Promise<DetectedProvider[]> {
    providers = await providerRegistry.refresh(force);
    app.setDetectedProviders(providers.map((p) => p.name));
    return providers;
  }

  function buildVisibleModelOptions(): Array<{ providerId: string; providerName: string; modelId: string; active: boolean }> {
    return providerRegistry.buildVisibleModelOptions(activeModel, currentModelId, getSettings().scopedModels);
  }

  const initPromise = (async () => {
    const boot = await bootstrapSession({
      opts,
      app,
      session,
      providerRegistry,
      currentMode,
      refreshProviderState,
    });
    providers = boot.providers;
    activeModel = boot.activeModel;
    currentModelId = boot.currentModelId;
    smallModel = boot.smallModel;
    smallModelId = boot.smallModelId;
    systemPrompt = boot.systemPrompt;
  })();

  const tools = {
    ...getTools(),
    askUser: createAskUserTool((q, opts) => app.showQuestion(q, opts)),
  };

  // Wire bash streaming output to UI
  setBashOutputCallback((chunk) => {
    app.appendToolOutput(chunk);
  });

  // Wire TODO list to UI
  setTodoChangeCallback((items) => {
    app.updateTodo(items);
  });

  // Handle pending messages when they become ready
  app.onPendingMessagesReadyHandler(() => {
    const pending = app.takePendingMessages();
    for (const msg of pending) {
      // Process each pending message
      processUserMessage(msg.text, msg.images);
    }
  });

  app.onInput(async (text, images) => {
    await initPromise;
    await processUserMessage(text, images);
  });

  async function processUserMessage(text: string, images?: Array<{ mimeType: string; data: string }>) {
    if (!text.trim()) return;

    // Slash commands
    let templateLoaded = false;
    if (text.startsWith("/")) {
      const [cmd] = text.slice(1).split(" ");
      switch (cmd) {
        case "help":
          app.addMessage("system", "Type / to see available commands.");
          return;
        case "new":
        case "clear":
          session.clear();
          app.clearMessages();
          app.resetCost();
          getContextOptimizer().reset();
          return;
        case "connect":
        case "login":
          await runConnectFlow({
            app,
            providerRegistry,
            refreshProviderState,
            isSkippedPromptAnswer,
            isValidHttpBaseUrl,
          });
          return;
        case "model": {
          const allOptions = buildVisibleModelOptions();
          if (allOptions.length === 0) {
            app.addMessage("system", "No connected providers found. Run /connect.");
            return;
          }
          app.openModelPicker(allOptions, (provId, modId) => {
            try {
              activeModel = providerRegistry.createModel(provId, modId);
              currentModelId = modId;
              systemPrompt = buildSystemPrompt(process.cwd(), provId, currentMode, getSettings().cavemanLevel ?? "off");
              app.setModel(activeModel.provider.name, currentModelId);
              session.setProviderModel(activeModel.provider.name, currentModelId);
              // Save as last used model
              updateSetting("lastModel", `${provId}/${modId}`);
            } catch (err) {
              app.addMessage("system", `Failed: ${(err as Error).message}`);
            }
          }, (provId, modId, pinned) => {
            const key = `${provId}/${modId}`;
            const scoped = getSettings().scopedModels;
            if (pinned && !scoped.includes(key)) {
              updateSetting("scopedModels", [...scoped, key]);
            } else if (!pinned) {
              updateSetting("scopedModels", scoped.filter((s: string) => s !== key));
            }
          }, 0); // Start at top of list
          return;
        }
        case "settings": {
          function buildEntries(): Array<{ key: string; label: string; value: string; description: string }> {
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
            ];
          }
          app.openSettings(buildEntries(), (key) => {
            const s = getSettings();
            const val = s[key as keyof Settings];
            if (key === "thinkingLevel") {
              const levels = ["off", "low", "medium", "high"] as const;
              const current = s.thinkingLevel || (s.enableThinking ? "low" : "off");
              const idx = levels.indexOf(current as any);
              const next = levels[(idx + 1) % levels.length];
              updateSetting("thinkingLevel", next);
              updateSetting("enableThinking", next !== "off");
            } else if (typeof val === "boolean") {
              updateSetting(key as keyof Settings, !val);
            } else if (key === "maxSessionCost") {
              const next = s.maxSessionCost === 0 ? 1 : s.maxSessionCost === 1 ? 5 : s.maxSessionCost === 5 ? 10 : 0;
              updateSetting("maxSessionCost", next);
            } else if (key === "followUpMode") {
              const modes: Array<"immediate" | "after_tool" | "after_response"> = ["immediate", "after_tool", "after_response"];
              const currentIdx = modes.indexOf(s.followUpMode);
              const nextIdx = (currentIdx + 1) % modes.length;
              updateSetting("followUpMode", modes[nextIdx]);
            } else if (key === "theme") {
              const themes = listThemes();
              const currentIdx = Math.max(0, themes.findIndex((theme) => theme.key === s.theme));
              updateSetting("theme", themes[(currentIdx + 1) % themes.length].key);
            } else if (key === "cavemanLevel") {
              const levels = ["off", "lite", "auto", "ultra"] as const;
              const current = s.cavemanLevel ?? "off";
              const idx = levels.indexOf(current as any);
              const next = levels[(idx + 1) % levels.length];
              updateSetting("cavemanLevel", next);
              reloadContext();
              systemPrompt = buildSystemPrompt(process.cwd(), activeModel?.provider?.id, currentMode, next);
            }
            app.updateSettings(buildEntries());
          });
          return;
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
          app.openItemPicker(
            "Theme",
            themeItems,
            (themeId) => {
              setPreviewTheme(null);
              updateSetting("theme", themeId);
            },
            {
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
                app.updateItemPickerItems(buildThemeItems(), themeId);
              },
            },
          );
          return;
        }
        case "compact": {
          if (!activeModel) {
            app.addMessage("system", "No model available for compaction.");
            return;
          }
          hooks.emit("on_message", { role: "user", content: text });
          try {
            const chatMsgs = session.getChatMessages();
            const ctxTokens = getTotalContextTokens(chatMsgs, systemPrompt, currentModelId);
            app.setCompacting(true, ctxTokens);
            const compacted = activeModel.runtime === "sdk" && activeModel.model
              ? await compactMessages(chatMsgs, activeModel.model)
              : chatMsgs.slice(-6);
            session.clear();
            for (const m of compacted) session.addMessage(m.role, m.content);
            app.setCompacting(false);
            app.clearMessages();
            app.addMessage("system", `Context compacted: ${chatMsgs.length} messages -> ${compacted.length}`);
          } catch (err) {
            app.setCompacting(false);
            app.addMessage("system", `Compact failed: ${(err as Error).message}`);
          }
          return;
        }
        case "fork": {
          const forked = session.fork();
          session = forked;
          if (activeModel) session.setProviderModel(activeModel.provider.name, currentModelId);
          app.addMessage("system", `Forked session. History preserved, new branch started.`);
          return;
        }
        case "caveman": {
          app.cycleCavemanMode();
          reloadContext();
          const lvl = getSettings().cavemanLevel ?? "off";
          systemPrompt = buildSystemPrompt(process.cwd(), activeModel?.provider?.id, currentMode, lvl);
          app.addMessage("system", `🪨 ${lvl}`);
          return;
        }
        case "thinking": {
          app.cycleThinkingMode();
          const lvl = getSettings().thinkingLevel || (getSettings().enableThinking ? "low" : "off");
          app.addMessage("system", `Thinking: ${lvl}`);
          return;
        }
        case "name": {
          const name = text.slice(6).trim();
          if (name) {
            app.addMessage("system", `Session named: ${name}`);
          } else {
            app.addMessage("system", "Usage: /name <session name>");
          }
          return;
        }
        case "copy": {
          const lastContent = app.getLastAssistantContent();
          if (!lastContent) {
            app.addMessage("system", "No response to copy.");
            return;
          }
          try {
            const { execSync } = await import("child_process");
            if (process.platform === "win32") {
              execSync("clip", { input: lastContent });
            } else if (process.platform === "darwin") {
              execSync("pbcopy", { input: lastContent });
            } else {
              execSync("xclip -selection clipboard", { input: lastContent });
            }
            app.addMessage("system", "Copied to clipboard.");
          } catch {
            app.addMessage("system", "Failed to copy to clipboard.");
          }
          return;
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
                if (process.platform === "win32") {
                  execSync("clip", { input: content });
                } else if (process.platform === "darwin") {
                  execSync("pbcopy", { input: content });
                } else {
                  execSync("xclip -selection clipboard", { input: content });
                }
                app.addMessage("system", "Transcript copied.");
              } else {
                writeFileSync(filePath, content, "utf-8");
                app.addMessage("system", `Exported to ${filePath}`);
              }
            } catch (err) {
              app.addMessage("system", `Export failed: ${(err as Error).message}`);
            }
          });
          return;
        }
        case "sessions":
        case "resume": {
          const cwd = process.cwd();
          const recent = Session.listRecent(10).filter((s) => s.cwd === cwd);
          if (recent.length === 0) {
            app.addMessage("system", "No sessions for this directory.");
            return;
          }
          const items = recent.map((s) => ({
            id: s.id,
            label: s.model || "unknown",
            detail: `${s.messageCount} msgs · ${formatRelativeMinutes(s.updatedAt)}`,
          }));
          app.openItemPicker("Resume Session", items, (sessionId) => {
            const loaded = Session.load(sessionId);
            if (loaded) {
              session = loaded;
              app.clearMessages();
              for (const msg of loaded.getMessages()) {
                app.addMessage(msg.role, msg.content);
              }
              app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
              app.addMessage("system", "Session resumed.");
            }
          });
          return;
        }
        case "undo": {
          const result = undoLastCheckpoint();
          app.addMessage("system", result.message);
          return;
        }
        case "templates": {
          const templates = listTemplates();
          if (templates.length === 0) {
            app.addMessage("system", "No templates found. Add .md files to ~/.brokecli/prompts/ or .brokecli/prompts/");
            return;
          }
          const lines = templates.map((t) => `  /${t.name}${t.description ? ` -- ${t.description}` : ""}`);
          app.addMessage("system", `Templates:\n${lines.join("\n")}`);
          return;
        }
        case "logout":
          app.addMessage("system", "OAuth login not yet implemented. Set API keys via environment variables: ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.");
          return;
        case "exit":
          app.stop();
          return;
        default: {
          // Check if it matches a prompt template
          const tpl = loadTemplate(cmd);
          if (tpl) {
            // Replace {{file}} placeholders with @file contexts
            let content = tpl;
            const fileContexts = app.getFileContexts();
            if (fileContexts.size > 0) {
              const contextBlock = [...fileContexts.entries()]
                .map(([path, fc]) => `--- @${path} ---\n${fc}`)
                .join("\n\n");
              content = content.replace(/\{\{file\}\}/g, contextBlock);
            }
            // Treat remaining args as appended text
            const rest = text.slice(1 + cmd.length).trim();
            if (rest) content = `${content}\n\n${rest}`;
            // Feed as a regular message, then continue to LLM
            app.addMessage("user", `/${cmd}${rest ? ` ${rest}` : ""}`);
            session.addMessage("user", content);
            templateLoaded = true;
            break;
          }
          app.addMessage("system", `Unknown: /${cmd}`);
          return;
        }
      }
    }

    if (!templateLoaded) {
      // !bash shortcuts
      if (text.startsWith("!!")) {
        const cmd = text.slice(2).trim();
        if (cmd) {
          try {
            const { execSync } = await import("child_process");
            execSync(cmd, { encoding: "utf-8", timeout: 30000, cwd: process.cwd(), stdio: "ignore" });
            app.addMessage("system", `ran: ${cmd}`);
          } catch (err) {
            app.addMessage("system", `failed: ${(err as Error).message.slice(0, 100)}`);
          }
        }
        return;
      }
      if (text.startsWith("!")) {
        const cmd = text.slice(1).trim();
        if (cmd) {
          try {
            const { execSync } = await import("child_process");
            const output = execSync(cmd, { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024, cwd: process.cwd() });
            app.addMessage("system", `$ ${cmd}\n${output.trim()}`);
            // Send output to LLM as context
            if (activeModel) {
              session.addMessage("user", `I ran \`${cmd}\` and got:\n\`\`\`\n${output.trim().slice(0, 2000)}\n\`\`\``);
            }
          } catch (err) {
            const e = err as { stdout?: string; stderr?: string; message: string };
            app.addMessage("system", `$ ${cmd}\n${e.stderr?.trim() || e.message}`);
          }
        }
        return;
      }
    }

    if (!activeModel) {
      app.addMessage("system", "No provider configured. Run /connect.");
      return;
    }
    const turnResult = await runModelTurn({
      app,
      session,
      text,
      images,
      activeModel,
      currentModelId,
      smallModel,
      smallModelId,
      currentMode,
      systemPrompt,
      tools,
      hooks,
      lastToolCalls,
      lastActivityTime,
      alreadyAddedUserMessage: templateLoaded,
    });
    lastToolCalls = turnResult.lastToolCalls;
    lastActivityTime = turnResult.lastActivityTime;
  }

// Close the program.action callback
});

program.parse();
