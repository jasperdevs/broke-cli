// Force chalk color detection before any imports that use it (marked-terminal)
process.env.FORCE_COLOR = "3";

import { Command } from "commander";
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
import { listThemes, getTheme } from "../src/core/themes.js";
import { undoLastCheckpoint } from "../src/core/git.js";
import { listTemplates, loadTemplate } from "../src/core/templates.js";
import { loadExtensions } from "../src/core/extensions.js";

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
      // Try to use last used model from settings
      const lastModel = getSettings().lastModel;
      if (lastModel) {
        const parts = lastModel.split("/");
        if (parts.length === 2) {
          // Check if provider still available
          const provider = providers.find(p => p.id === parts[0]);
          if (provider) {
            providerId = parts[0];
            modelId = parts[1];
          }
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

  app.onInput(async (text) => {
    await initPromise;

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
          return;
        case "cost":
          app.addMessage("system", `$${session.getTotalCost().toFixed(4)} | ${session.getTotalTokens()} tokens`);
          return;
        case "model": {
          const detectedIds = new Set(providers.map((p) => p.id));
          const pinnedModels = getSettings().scopedModels;
          const allOptions: Array<{ providerId: string; providerName: string; modelId: string; active: boolean }> = [];
          for (const prov of listProviders()) {
            if (!detectedIds.has(prov.id)) continue;
            for (const m of prov.models) {
              allOptions.push({
                providerId: prov.id,
                providerName: prov.name,
                modelId: m,
                active: pinnedModels.includes(`${prov.id}/${m}`),
              });
            }
          }
          // Sort: pinned models first, then by provider, then by model name
          allOptions.sort((a, b) => {
            if (a.active && !b.active) return -1;
            if (!a.active && b.active) return 1;
            if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
            return a.modelId.localeCompare(b.modelId);
          });
          if (allOptions.length === 0) {
            app.addMessage("system", "No providers detected. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
            return;
          }
          // Put cursor on current model
          const cursorIdx = allOptions.findIndex(opt => opt.providerId === activeModel?.provider?.id && opt.modelId === currentModelId);
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
          }, cursorIdx >= 0 ? cursorIdx : 0);
          return;
        }
        case "settings": {
          function buildEntries(): Array<{ key: string; label: string; value: string; description: string }> {
            const s = getSettings();
            return [
              { key: "yoloMode", label: "Yolo mode", value: String(s.yoloMode), description: "Run commands without safety checks" },
              { key: "autoCompact", label: "Auto-compact", value: String(s.autoCompact), description: "Automatically compress context when it gets too large" },
              { key: "autoSaveSessions", label: "Auto-save sessions", value: String(s.autoSaveSessions), description: "Save conversation history to disk" },
              { key: "gitCheckpoints", label: "Git checkpoints", value: String(s.gitCheckpoints), description: "Auto-commit before file modifications" },
              { key: "enableThinking", label: "Enable thinking", value: String(s.enableThinking), description: "Show model reasoning when supported" },
              { key: "showTokens", label: "Show tokens", value: String(s.showTokens), description: "Display token count in status bar" },
              { key: "showCost", label: "Show cost", value: String(s.showCost), description: "Display cost in status bar" },
              { key: "maxSessionCost", label: "Max session cost", value: s.maxSessionCost === 0 ? "unlimited" : `$${s.maxSessionCost}`, description: "Maximum cost per session (0 = unlimited)" },
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
            }
            app.updateSettings(buildEntries());
          });
          return;
        }
        case "theme": {
          const themes = listThemes();
          const current = getSettings().theme;
          const options = themes.map((t) => ({
            providerId: t,
            providerName: "",
            modelId: t,
            active: t === current,
          }));
          app.openModelPicker(options, (themeId) => {
            getTheme(themeId); // validate it exists
            updateSetting("theme", themeId);
            app.addMessage("system", `Theme set to: ${themeId}`);
          });
          return;
        }
        case "compact": {
          if (!activeModel) {
            app.addMessage("system", "No model available for compaction.");
            return;
          }
          app.addMessage("system", "Compacting context...");
          hooks.emit("on_message", { role: "user", content: text });
    app.setStreaming(true);
          try {
            const chatMsgs = session.getChatMessages();
            const compacted = await compactMessages(chatMsgs, activeModel.model);
            session.clear();
            for (const m of compacted) session.addMessage(m.role, m.content);
            app.clearMessages();
            app.addMessage("system", `Context compacted: ${chatMsgs.length} messages -> ${compacted.length}`);
          } catch (err) {
            app.addMessage("system", `Compact failed: ${(err as Error).message}`);
          }
          app.setStreaming(false);
          return;
        }
        case "sessions": {
          const recent = Session.listRecent(5);
          if (recent.length === 0) {
            app.addMessage("system", "No saved sessions.");
            return;
          }
          const lines = recent.map((s) => {
            const ago = Math.floor((Date.now() - s.updatedAt) / 60000);
            const time = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`;
            return `  ${s.model}  ${s.messageCount} msgs  $${s.cost.toFixed(4)}  ${time}`;
          });
          app.addMessage("system", `Recent sessions:\n${lines.join("\n")}\n\nUse brokecli -c to resume last session.`);
          return;
        }
        case "new":
          session = new Session();
          if (activeModel) session.setProviderModel(activeModel.provider.name, currentModelId);
          app.clearMessages();
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
          const filePath = text.slice(8).trim() || "brokecli-export.md";
          const msgs = session.getMessages();
          const md = msgs.map((m) => {
            if (m.role === "user") return `## User\n\n${m.content}\n`;
            if (m.role === "assistant") return `## Assistant\n\n${m.content}\n`;
            return `> ${m.content}\n`;
          }).join("\n");
          try {
            const { writeFileSync } = await import("fs");
            writeFileSync(filePath, md, "utf-8");
            app.addMessage("system", `Exported to ${filePath}`);
          } catch (err) {
            app.addMessage("system", `Export failed: ${(err as Error).message}`);
          }
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
      app.addMessage("system", "Context getting large, auto-compacting...");
      try {
        const compacted = await compactMessages(chatMsgs, activeModel.model);
        session.clear();
        for (const m of compacted) session.addMessage(m.role, m.content);
      } catch {
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

      app.addMessage("user", text);
      session.addMessage("user", fullText);
    }

    app.setStreaming(true);

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
        system: systemPrompt,
        messages: session.getChatMessages(),
        // Only pass tools for providers known to support function calling
        tools: ["anthropic", "openai", "codex", "google", "mistral", "groq", "xai", "openrouter"].includes(activeModel.provider.id) ? tools : undefined,
        abortSignal: abortController.signal,
      },
      {
        onText: (delta) => {
          app.appendToLastMessage(delta);
        },
        onReasoning: (delta) => {
          app.appendThinking(delta);
        },
        onFinish: (usage) => {
          const content = app.getLastAssistantContent();
          if (content) {
            session.addMessage("assistant", content);
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
          if (msg.includes("insufficient permissions") || msg.includes("Missing scopes")) {
            msg = `API key lacks permissions. Try /model to switch.`;
          } else if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key")) {
            msg = `Invalid API key.`;
          }
          if (msg.length > 200) msg = msg.slice(0, 197) + "...";
          // Add a fake assistant reply so session stays valid (no consecutive user messages)
          session.addMessage("assistant", `[error: ${msg}]`);
          app.addMessage("system", `Error: ${msg}`);
          app.setStreaming(false);
          abortController = null;
        },
        onToolCall: (name, args) => {
          hooks.emit("on_tool_call", { name, args });
          const preview = typeof args === "object" && args !== null
            ? JSON.stringify(args).slice(0, 80)
            : String(args).slice(0, 80);
          app.addMessage("system", `> ${name} ${preview}`);
        },
        onToolResult: (_name, result) => {
          hooks.emit("on_tool_result", { name: _name, result });
          const r = result as { success?: boolean; output?: string; error?: string };
          if (r.success === false && r.error) {
            app.addMessage("system", `  error: ${r.error.slice(0, 100)}`);
          } else if (r.output) {
            const lines = r.output.split("\n");
            const preview = lines.length > 5
              ? lines.slice(0, 5).join("\n") + `\n  ... (${lines.length} lines)`
              : r.output;
            app.addMessage("system", preview.slice(0, 500));
          }
        },
      },
    );
  });
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
