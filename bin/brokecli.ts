import { Command } from "commander";
import { execSync } from "child_process";
import { App } from "../src/tui/app.js";
import type { DetectedProvider } from "../src/ai/detect.js";
import type { ModelHandle } from "../src/ai/providers.js";
import { buildSystemPrompt, reloadContext } from "../src/core/context.js";
import { Session } from "../src/core/session.js";
import { touchProject } from "../src/core/projects.js";
import { getTools } from "../src/tools/registry.js";
import { createAskUserTool } from "../src/tools/ask.js";
import { createSubagentTool } from "../src/tools/subagent.js";
import { setBashOutputCallback } from "../src/tools/bash.js";
import { setTodoChangeCallback } from "../src/tools/todo.js";
import { getApiKey, getSettings, updateSetting, type Mode } from "../src/core/config.js";
import { loadExtensions } from "../src/core/extensions.js";
import { ProviderRegistry } from "../src/ai/provider-registry.js";
import { runRpcMode } from "../src/cli/rpc.js";
import { bootstrapSession } from "../src/cli/session-bootstrap.js";
import { runModelTurn } from "../src/cli/turn-runner.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";

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
  if (opts.continue && getSettings().autoSaveSessions) {
    const recent = Session.listRecent(1, "", process.cwd());
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

  const buildTools = () => ({
    ...getTools({
      extraTools: {
        subagent: createSubagentTool({
          cwd: () => process.cwd(),
          providerRegistry,
          getActiveModel: () => activeModel,
          getCurrentModelId: () => currentModelId,
        }),
      },
    }),
    askUser: createAskUserTool((q, opts) => app.showQuestion(q, opts)),
  });

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
      const slashResult = await handleSlashCommand({
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
        onSessionReplace: (nextSession) => {
          session = nextSession;
        },
        onModelChange: (nextModel, nextModelId) => {
          activeModel = nextModel;
          currentModelId = nextModelId;
          systemPrompt = buildSystemPrompt(process.cwd(), nextModel.provider.id, currentMode, getSettings().cavemanLevel ?? "off");
        },
        onSystemPromptChange: (nextSystemPrompt) => {
          systemPrompt = nextSystemPrompt;
        },
        hooks,
        onProjectChange: (cwd) => {
          process.chdir(cwd);
          app.setCwd(cwd);
          const recent = Session.listRecent(1, "", cwd);
          if (recent.length > 0) {
            const loaded = Session.load(recent[0].id);
            if (loaded) {
              session = loaded;
              app.clearMessages();
              for (const msg of loaded.getMessages()) app.addMessage(msg.role, msg.content);
              app.updateUsage(loaded.getTotalCost(), loaded.getTotalInputTokens(), loaded.getTotalOutputTokens());
            }
          } else {
            session = new Session();
            app.clearMessages();
            app.resetCost();
          }
          systemPrompt = buildSystemPrompt(process.cwd(), activeModel?.provider?.id, currentMode, getSettings().cavemanLevel ?? "off");
        },
      });
      if (slashResult.templateLoaded) {
        templateLoaded = true;
      }
      if (slashResult.handled) {
        return;
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
    touchProject(process.cwd(), session.getId(), text);
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
      tools: buildTools(),
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
