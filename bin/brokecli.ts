import { Command } from "commander";
import { writeFileSync } from "fs";
import { App } from "../src/tui/app.js";
import { detectProviders, pickDefault } from "../src/ai/detect.js";
import { createModel, listProviders, refreshLocalModels } from "../src/ai/providers.js";
import { startStream } from "../src/ai/stream.js";
import { loadPricing } from "../src/ai/cost.js";
import { buildSystemPrompt, reloadContext } from "../src/core/context.js";
import { Session } from "../src/core/session.js";
import { getTools } from "../src/tools/registry.js";
import { renderMarkdown } from "../src/utils/markdown.js";
import { checkBudget } from "../src/core/budget.js";
import { getSettings, updateSetting, type Settings, type Mode } from "../src/core/config.js";
import { compactMessages, getTotalContextTokens } from "../src/core/compact.js";
import { undoLastCheckpoint } from "../src/core/git.js";
import { listTemplates, loadTemplate } from "../src/core/templates.js";
import { loadExtensions } from "../src/core/extensions.js";
import { RESET, DIM, RED, GREEN } from "../src/utils/ansi.js";

const program = new Command()
  .name("brokecli")
  .description("AI coding CLI that doesn't waste your money")
  .version("0.0.1")
  .option("--broke", "Route to cheapest capable model")
  .option("-m, --model <model>", "Model to use (provider/model-id)")
  .option("-c, --continue", "Continue last session")
  .option("-p, --print", "Single-shot mode: print response and exit")
  .option("--rpc", "Non-interactive JSON RPC mode");

program.action(async (opts) => {
  // Load extension hooks
  const hooks = loadExtensions();

  // RPC mode � non-interactive JSON I/O
  if (opts.rpc) {
    await runRpcMode(hooks, opts);
    return;
  }

  const app = new App();
  let currentMode: Mode = getSettings().mode;
  let systemPrompt = buildSystemPrompt(process.cwd(), undefined, currentMode);
  let abortController: AbortController | null = null;

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

  app.start();
  hooks.emit("on_session_start", { cwd: process.cwd() });

  // Scoped model index for Ctrl+P cycling
  let scopedModelIndex = -1;

  // Mode toggle callback
  app.onModeToggle((newMode) => {
    currentMode = newMode;
    const activeProvider = activeModel?.provider?.id;
    systemPrompt = buildSystemPrompt(process.cwd(), activeProvider, currentMode);
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
    const parts = entry.split("/");
    if (parts.length === 2) {
      try {
        activeModel = createModel(parts[0], parts[1]);
        currentModelId = parts[1];
        systemPrompt = buildSystemPrompt(process.cwd(), parts[0], currentMode);
        app.setModel(activeModel.provider.name, currentModelId);
        session.setProviderModel(activeModel.provider.name, currentModelId);
        updateSetting("lastModel", entry);
      } catch (err) {
        app.addMessage("system", `Failed to switch: ${(err as Error).message}`);
      }
    }
  });

  // Detect providers + load pricing in background
  let providers: Awaited<ReturnType<typeof detectProviders>> = [];
  let activeModel: ReturnType<typeof createModel> | null = null;
  let currentModelId = "";

  const initPromise = (async () => {
    [, providers] = await Promise.all([loadPricing(), detectProviders()]);
    app.setDetectedProviders(providers.map((p) => p.name));
    await refreshLocalModels(providers.map((p) => p.id));

    let providerId: string | undefined;
    let modelId: string | undefined;

    if (opts.model) {
      const parts = opts.model.split("/");
      if (parts.length === 2) {
        providerId = parts[0];
        modelId = parts[1];
      } else {
        const def = pickDefault(providers);
        providerId = def?.id ?? "openai";
        modelId = opts.model;
      }
    } else {
      // Try to use last used model from settings — trust it even if provider
      // wasn't detected (local server may be slow to start, key may still work)
      const lastModel = getSettings().lastModel;
      if (lastModel) {
        const parts = lastModel.split("/");
        if (parts.length === 2) {
          providerId = parts[0];
          modelId = parts[1];
        }
      }
      if (!providerId) {
        const def = pickDefault(providers);
        if (!def) {
          app.addMessage("system", "No providers found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or start Ollama.");
          return;
        }
        providerId = def.id;
      }
    }

    try {
      activeModel = createModel(providerId!, modelId);
      currentModelId = modelId ?? activeModel.provider.defaultModel;
      systemPrompt = buildSystemPrompt(process.cwd(), providerId!, currentMode);
      app.setModel(activeModel.provider.name, currentModelId);
      app.setMode(currentMode);
      session.setProviderModel(activeModel.provider.name, currentModelId);
      // Save as last used model
      updateSetting("lastModel", `${activeModel.provider.id}/${currentModelId}`);
      app.clearStatus();
    } catch (err) {
      app.addMessage("system", `Failed to init ${providerId}: ${(err as Error).message}`);
    }
  })();

  const tools = getTools();

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
        case "clear":
          session.clear();
          app.clearMessages();
          app.resetCost();
          return;
        case "cost":
          app.addMessage("system", `$${session.getTotalCost().toFixed(4)} | ${session.getTotalTokens()} tokens`);
          return;
        case "model": {
          const detectedIds = new Set(providers.map((p) => p.id));
          const pinnedModels = getSettings().scopedModels;
          const allOptions: Array<{ providerId: string; providerName: string; modelId: string; active: boolean }> = [];
          for (const prov of listProviders()) {
            for (const m of prov.models) {
              allOptions.push({
                providerId: prov.id,
                providerName: prov.name,
                modelId: m,
                active: pinnedModels.includes(`${prov.id}/${m}`),
              });
            }
          }
          // Sort: available providers first, then pinned models, then by provider/name
          allOptions.sort((a, b) => {
            // Available (detected) first
            const aAvail = detectedIds.has(a.providerId);
            const bAvail = detectedIds.has(b.providerId);
            if (aAvail && !bAvail) return -1;
            if (!aAvail && bAvail) return 1;
            // Then pinned
            if (a.active && !b.active) return -1;
            if (!a.active && b.active) return 1;
            // Then by provider, then model
            if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
            return a.modelId.localeCompare(b.modelId);
          });
          if (allOptions.length === 0) {
            app.addMessage("system", "No providers found. Run /login or set API keys.");
            return;
          }
          app.openModelPicker(allOptions, (provId, modId) => {
            try {
              activeModel = createModel(provId, modId);
              currentModelId = modId;
              systemPrompt = buildSystemPrompt(process.cwd(), provId, currentMode);
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
              { key: "enableThinking", label: "Enable thinking", value: String(s.enableThinking), description: "Show model reasoning when supported" },
              { key: "showTokens", label: "Show tokens", value: String(s.showTokens), description: "Display token count in status bar" },
              { key: "showCost", label: "Show cost", value: String(s.showCost), description: "Display cost in status bar" },
              { key: "maxSessionCost", label: "Max session cost", value: s.maxSessionCost === 0 ? "unlimited" : `$${s.maxSessionCost}`, description: "Maximum cost per session (0 = unlimited)" },
              { key: "followUpMode", label: "Follow-up mode", value: followUpLabels[s.followUpMode] ?? s.followUpMode, description: "When to send queued messages while AI is working" },
            ];
          }
          app.openSettings(buildEntries(), (key) => {
            const s = getSettings();
            const val = s[key as keyof Settings];
            if (typeof val === "boolean") {
              updateSetting(key as keyof Settings, !val);
            } else if (key === "maxSessionCost") {
              const next = s.maxSessionCost === 0 ? 1 : s.maxSessionCost === 1 ? 5 : s.maxSessionCost === 5 ? 10 : 0;
              updateSetting("maxSessionCost", next);
            } else if (key === "followUpMode") {
              const modes: Array<"immediate" | "after_tool" | "after_response"> = ["immediate", "after_tool", "after_response"];
              const currentIdx = modes.indexOf(s.followUpMode);
              const nextIdx = (currentIdx + 1) % modes.length;
              updateSetting("followUpMode", modes[nextIdx]);
            }
            app.updateSettings(buildEntries());
          });
          return;
        }
        case "theme":
          app.addMessage("system", "Themes have been removed.");
          return;
        case "compact": {
          if (!activeModel) {
            app.addMessage("system", "No model available for compaction.");
            return;
          }
          hooks.emit("on_message", { role: "user", content: text });
          try {
            const chatMsgs = session.getChatMessages();
            const ctxTokens = getTotalContextTokens(chatMsgs, systemPrompt);
            app.setCompacting(true, ctxTokens);
            const compacted = await compactMessages(chatMsgs, activeModel.model);
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
        case "sessions": {
          const recent = Session.listRecent(20);
          if (recent.length === 0) {
            app.addMessage("system", "No saved sessions.");
            return;
          }
          const items = recent.map((s) => {
            const ago = Math.floor((Date.now() - s.updatedAt) / 60000);
            const time = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`;
            const cost = `$${s.cost.toFixed(4)}`;
            return {
              id: s.id,
              label: s.model || "unknown",
              detail: `${s.messageCount} msgs ${cost} ${time}`,
            };
          });
          app.openItemPicker("Sessions", items, (id) => {
            const loaded = Session.load(id);
            if (loaded) {
              session = loaded;
              if (activeModel) session.setProviderModel(activeModel.provider.name, currentModelId);
              app.clearMessages();
              app.addMessage("system", `Resumed session`);
            } else {
              app.addMessage("system", "Failed to load session");
            }
          });
          return;
        }
        case "new":
          session = new Session();
          if (activeModel) session.setProviderModel(activeModel.provider.name, currentModelId);
          app.clearMessages();
          app.resetCost();
          app.addMessage("system", "New session started. Use /clear to reset current session.");
          return;
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
          ];
          app.openItemPicker("Export format", items, (id) => {
            const defaultPath = `brokecli-export.${id === "html" ? "html" : "md"}`;
            const filePath = text.slice(8).trim() || defaultPath;
            const msgs = session.getMessages();
            let content = "";
            const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
            if (id === "html") {
              content = `<!DOCTYPE html>
<html>
<head><title>BrokeCLI Export</title>
<style>
body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 20px; background: #000; color: #fff; }
.user { background: #1a1a1a; padding: 10px; border-radius: 8px; margin: 10px 0; }
.assistant { background: #0a0a0a; color: #10b981; padding: 10px; border-radius: 8px; margin: 10px 0; white-space: pre-wrap; }
.system { color: #666; font-style: italic; padding: 10px; }
</style></head>
<body>
${msgs.map((m) => `<div class="${m.role}">${m.role === "assistant" ? esc(m.content) : m.content}</div>`).join("\n")}
</body>
</html>`;
            } else {
              content = msgs.map((m) => `## ${m.role}\n\n${m.content}\n`).join("\n");
            }
            try {
              writeFileSync(filePath, content, "utf-8");
              app.addMessage("system", `Exported to ${filePath}`);
            } catch (err) {
              app.addMessage("system", `Export failed: ${(err as Error).message}`);
            }
          });
          return;
        }
        case "resume": {
          const cwd = process.cwd();
          const recent = Session.listRecent(10).filter((s) => s.cwd === cwd);
          if (recent.length === 0) {
            app.addMessage("system", "No sessions for this directory.");
            return;
          }
          const options = recent.map((s) => {
            const ago = Math.floor((Date.now() - s.updatedAt) / 60000);
            const time = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`;
            return {
              providerId: s.id,
              providerName: time,
              modelId: `${s.model} (${s.messageCount} msgs, $${s.cost.toFixed(4)})`,
              active: false,
            };
          });
          app.openModelPicker(options, (sessionId) => {
            const loaded = Session.load(sessionId);
            if (loaded) {
              session = loaded;
              app.clearMessages();
              for (const msg of loaded.getMessages()) {
                app.addMessage(msg.role, msg.content);
              }
              app.updateCost(session.getTotalCost(), session.getTotalTokens());
              app.addMessage("system", "Session resumed.");
            }
          });
          return;
        }
        case "reload":
          reloadContext();
          app.addMessage("system", "Context reloaded.");
          return;
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
        case "login":
          app.addMessage("system", "OAuth login not yet implemented. Set API keys via environment variables: ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.");
          return;
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
      app.addMessage("system", "No provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
      return;
    }

    // Budget check
    const budget = checkBudget(session.getTotalCost());
    if (!budget.allowed) {
      app.addMessage("system", budget.warning!);
      return;
    }
    if (budget.warning) {
      app.setStatus(budget.warning);
    }

    // Context size tracking
    const chatMsgs = session.getChatMessages();
    const ctxTokens = getTotalContextTokens(chatMsgs, systemPrompt);
    const ctxPct = Math.min(100, Math.round((ctxTokens / 128000) * 100));
    app.setContextUsed(ctxPct);

    // Auto-compact if context > 80%
    if (ctxPct > 80 && chatMsgs.length > 8) {
      try {
        app.setCompacting(true, ctxTokens);
        const compacted = await compactMessages(chatMsgs, activeModel.model);
        session.clear();
        for (const m of compacted) session.addMessage(m.role, m.content);
        app.setCompacting(false);
        app.addMessage("system", `Auto-compacted: ${chatMsgs.length} -> ${compacted.length} messages`);
      } catch {
        app.setCompacting(false);
        // Continue with full context if compact fails
      }
    }

    if (!templateLoaded) {
      // Inject @file contexts into the message
      const fileContexts = app.getFileContexts();
      let fullText = text;
      if (fileContexts.size > 0) {
        const contextBlock = [...fileContexts.entries()]
          .map(([path, content]) => `--- @${path} ---\n${content}`)
          .join("\n\n");
        fullText = `${text}\n\n${contextBlock}`;
      }

      app.addMessage("user", text, images);
      session.addMessage("user", fullText, images);
    }

    app.setStreaming(true);
    let streamCharCount = 0;

    abortController = new AbortController();
    app.onAbortRequest(() => {
      abortController?.abort();
      app.setStreaming(false);
      app.addMessage("system", "Cancelled.");
      abortController = null;
    });

    await startStream(
      {
        model: activeModel.model,
        modelId: currentModelId,
        providerId: activeModel.provider.id,
        system: systemPrompt,
        messages: session.getChatMessages(),
        tools,
        abortSignal: abortController.signal,
        enableThinking: getSettings().enableThinking,
      },
      {
        onText: (delta) => {
          app.appendToLastMessage(delta);
          streamCharCount += delta.length;
          // Rough token estimate (1 token ~ 4 chars of output)
          app.setStreamTokens(Math.round(streamCharCount / 4));
        },
        onReasoning: (delta) => {
          app.appendThinking(delta);
        },
        onFinish: (usage) => {
          const content = app.getLastAssistantContent();
          if (content) {
            session.addMessage("assistant", content);
          } else {
            // Model returned empty response
            session.addMessage("assistant", "[empty response]");
            app.addMessage("system", `${DIM}No response from model. Try again or switch models with /model.${RESET}`);
          }
          session.addUsage(usage.inputTokens, usage.outputTokens, usage.cost);
          app.updateCost(session.getTotalCost(), session.getTotalTokens());
          app.setStreaming(false);
          abortController = null;
        },
        onError: (err) => {
          let msg = err.message;
          const data = (err as any).data;
          if (data?.error?.message) msg = data.error.message;
          // Make errors human-friendly
          if (msg.includes("insufficient permissions") || msg.includes("Missing scopes")) {
            msg = `Your API key doesn't have access to this model. Try a different model with /model.`;
          } else if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key") || msg.includes("401")) {
            msg = `Invalid API key for ${activeModel?.provider.name ?? "this provider"}. Check your key and try again.`;
          } else if (msg.includes("Could not resolve") || msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
            msg = `Can't reach ${activeModel?.provider.name ?? "the provider"}. Check your connection or if the server is running.`;
          } else if (msg.includes("429") || msg.includes("rate_limit")) {
            msg = `Rate limited. Wait a moment and try again.`;
          } else if (msg.includes("model_not_found") || msg.includes("does not exist") || msg.includes("not found")) {
            msg = `Model "${currentModelId}" not available. Try /model to pick a different one.`;
          } else if (msg.includes("overloaded") || msg.includes("503") || msg.includes("529")) {
            msg = `${activeModel?.provider.name ?? "Provider"} is overloaded right now. Try again in a moment.`;
          }
          if (msg.length > 300) msg = msg.slice(0, 297) + "...";
          session.addMessage("assistant", `[error: ${msg}]`);
          app.setStreaming(false);
          app.addMessage("system", `${RED}${msg}${RESET}`);
          abortController = null;
        },
        onToolCall: (name, args) => {
          hooks.emit("on_tool_call", { name, args });
          let preview = "";
          if (name === "writeFile" || name === "editFile") {
            preview = (args as any)?.path ?? "?";
          } else if (name === "readFile" || name === "listFiles" || name === "grep") {
            preview = (args as any)?.path ?? (args as any)?.pattern ?? "?";
          } else if (name === "bash") {
            const cmd = (args as any)?.command ?? "?";
            preview = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
          } else {
            preview = typeof args === "object" ? JSON.stringify(args).slice(0, 50) : String(args).slice(0, 50);
          }
          app.addToolCall(name, preview, args);
        },
        onToolResult: (_name, result) => {
          hooks.emit("on_tool_result", { name: _name, result });
          const r = result as { success?: boolean; output?: string; error?: string; content?: string; matches?: unknown[]; files?: string[] };
          let detail: string | undefined;
          if (_name === "bash" && r.output) {
            detail = r.output.slice(0, 200);
          } else if (_name === "readFile" && r.content) {
            const lineCount = r.content.split("\n").length;
            detail = `${lineCount} lines`;
          } else if (_name === "grep" && r.matches) {
            detail = `${(r.matches as unknown[]).length} matches`;
          } else if (_name === "listFiles" && r.files) {
            detail = `${(r.files as string[]).length} files`;
          }
          if (r.success === false && r.error) {
            app.addToolResult(_name, r.error.slice(0, 80), true);
          } else {
            app.addToolResult(_name, "ok", false, detail);
          }
        },
        onAfterToolCall: () => {
          // Check if we need to flush pending messages after tool call
          const settings = getSettings();
          if (settings.followUpMode === "after_tool" && app.hasPendingMessages()) {
            app.flushPendingMessages();
          }
        },
        onAfterResponse: () => {
          // Check if we need to flush pending messages after response
          const settings = getSettings();
          if (settings.followUpMode === "after_response" && app.hasPendingMessages()) {
            app.flushPendingMessages();
          }
        },
      },
    );
  }

// Close the program.action callback
});

async function runRpcMode(hooks: ReturnType<typeof loadExtensions>, opts: any): Promise<void> {
  const rpcMode = getSettings().mode;
  let systemPrompt = buildSystemPrompt(process.cwd(), undefined, rpcMode);
  let abortController: AbortController | null = null;

  const [, providers] = await Promise.all([loadPricing(), detectProviders()]);
  await refreshLocalModels(providers.map((p) => p.id));

  let providerId: string;
  let modelId: string | undefined;

  if (opts.model) {
    const parts = opts.model.split("/");
    if (parts.length === 2) {
      providerId = parts[0];
      modelId = parts[1];
    } else {
      const def = pickDefault(providers);
      providerId = def?.id ?? "openai";
      modelId = opts.model;
    }
  } else {
    const def = pickDefault(providers);
    if (!def) {
      process.stdout.write(JSON.stringify({ type: "error", message: "No providers found" }) + "\n");
      process.exit(1);
      return;
    }
    providerId = def.id;
  }

  let activeModel: ReturnType<typeof createModel>;
  try {
    activeModel = createModel(providerId, modelId);
  } catch (err) {
    process.stdout.write(JSON.stringify({ type: "error", message: (err as Error).message }) + "\n");
    process.exit(1);
    return;
  }

  const currentModelId = modelId ?? activeModel.provider.defaultModel;
  systemPrompt = buildSystemPrompt(process.cwd(), providerId, rpcMode);
  const tools = getTools();
  const session = new Session();

  await hooks.emit("on_session_start", { cwd: process.cwd(), rpc: true });

  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin });

  function writeLine(obj: object): void {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }

  for await (const line of rl) {
    let msg: { type: string; content?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      writeLine({ type: "error", message: "Invalid JSON" });
      continue;
    }

    if (msg.type === "abort") {
      abortController?.abort();
      abortController = null;
      continue;
    }

    if (msg.type !== "message" || !msg.content) {
      writeLine({ type: "error", message: 'Expected {"type":"message", "content":"..."}' });
      continue;
    }

    session.addMessage("user", msg.content);
    await hooks.emit("on_message", { role: "user", content: msg.content });

    abortController = new AbortController();

    await startStream(
      {
        model: activeModel.model,
        modelId: currentModelId,
        system: systemPrompt,
        messages: session.getChatMessages(),
        tools: ["anthropic", "openai", "codex", "google", "mistral", "groq", "xai", "openrouter"].includes(activeModel.provider.id) ? tools : undefined,
        abortSignal: abortController.signal,
      },
      {
        onText: (delta) => {
          writeLine({ type: "text", content: delta });
        },
        onReasoning: () => {},
        onFinish: (usage) => {
          session.addMessage("assistant", ""); // placeholder
          session.addUsage(usage.inputTokens, usage.outputTokens, usage.cost);
          writeLine({ type: "done", usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.cost } });
          abortController = null;
        },
        onError: (err) => {
          writeLine({ type: "error", message: err.message.slice(0, 200) });
          session.addMessage("assistant", "[error]");
          abortController = null;
        },
        onToolCall: (name, args) => {
          hooks.emit("on_tool_call", { name, args });
          writeLine({ type: "tool_call", name, args });
        },
        onToolResult: (_name, result) => {
          hooks.emit("on_tool_result", { name: _name, result });
          writeLine({ type: "tool_result", name: _name, result });
        },
      },
    );
  }

  await hooks.emit("on_session_end", { cost: session.getTotalCost(), tokens: session.getTotalTokens() });
}

program.parse();
