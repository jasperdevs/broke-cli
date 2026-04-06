import { Command } from "commander";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { App } from "../src/tui/app.js";
import type { DetectedProvider } from "../src/ai/detect.js";
import type { ModelHandle } from "../src/ai/providers.js";
import { getSmallModelId } from "../src/ai/router.js";
import { buildSystemPrompt, reloadContext } from "../src/core/context.js";
import { Session } from "../src/core/session.js";
import { SessionManager } from "../src/core/session-manager.js";
import { touchProject } from "../src/core/projects.js";
import { getTools, TOOL_NAMES, type ToolName } from "../src/tools/registry.js";
import { createAskUserTool } from "../src/tools/ask.js";
import { createAgentTool } from "../src/tools/subagent.js";
import { setBashOutputCallback } from "../src/tools/bash.js";
import { setTodoChangeCallback } from "../src/tools/todo.js";
import { getApiKey, getSettings, updateSetting, type Mode } from "../src/core/config.js";
import { clearRuntimeSettings, setRuntimeProviderApiKey, setRuntimeSettings } from "../src/core/config.js";
import { loadExtensions } from "../src/core/extensions.js";
import { APP_VERSION } from "../src/core/app-meta.js";
import { ProviderRegistry } from "../src/ai/provider-registry.js";
import { runRpcMode } from "../src/cli/rpc.js";
import { resolveOneShotModel, runOneShotPrompt } from "../src/cli/oneshot.js";
import { bootstrapSession } from "../src/cli/session-bootstrap.js";
import { runModelTurn } from "../src/cli/turn-runner.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { buildHtmlExport } from "../src/cli/exports.js";
import { registerPackageCommands } from "../src/cli/package-commands.js";
import { ensureConfiguredPackagesInstalled } from "../src/core/package-manager.js";
import { checkForNewVersion } from "../src/core/update.js";

const program = new Command()
  .name("brokecli")
  .description("AI coding CLI that doesn't waste your money")
  .version(APP_VERSION)
  .argument("[prompt...]", "Prompt to run in single-shot print/json mode")
  .option("--broke", "Route to cheapest capable model")
  .option("--provider <provider>", "Provider to use")
  .option("-m, --model <model>", "Model to use (provider/model-id)")
  .option("--api-key <key>", "Runtime API key override")
  .option("-c, --continue", "Continue last session")
  .option("-r, --resume", "Resume the most recent session")
  .option("--session-id <id>", "Open a specific saved session")
  .option("--fork <id>", "Fork from a specific saved session")
  .option("--session-dir <path>", "Override the session directory for this run")
  .option("-p, --print", "Single-shot mode: print response and exit")
  .option("--mode <mode>", "Output mode: tui, json, or rpc", "tui")
  .option("--tools <patterns>", "Comma-separated tool allowlist/excludes for this run")
  .option("--thinking <level>", "Thinking level: off, minimal, low, medium, high, xhigh")
  .option("--theme <theme>", "Theme override for this run")
  .option("--models <patterns>", "Comma-separated model patterns for cycling")
  .option("--list-models [search]", "List visible models and exit")
  .option("--system-prompt <text>", "Replace the default system prompt for this run")
  .option("--append-system-prompt <text>", "Append to the system prompt for this run")
  .option("-e, --extension <source>", "Load extension path/package for this run", (value, acc: string[]) => [...acc, value], [])
  .option("--skill <source>", "Load skill path/package for this run", (value, acc: string[]) => [...acc, value], [])
  .option("--prompt-template <source>", "Load prompt template path/package for this run", (value, acc: string[]) => [...acc, value], [])
  .option("--theme-path <source>", "Load theme path/package for this run", (value, acc: string[]) => [...acc, value], [])
  .option("--no-extensions", "Disable extension discovery for this run")
  .option("--no-skills", "Disable skill discovery for this run")
  .option("--no-prompt-templates", "Disable prompt-template discovery for this run")
  .option("--no-themes", "Disable theme discovery for this run")
  .option("--export <session>", "Export a saved session to HTML")
  .option("--export-out <path>", "Output path for --export")
  .option("--verbose", "Force verbose startup")
  .option("--no-session", "Disable session persistence for this run")
  .option("--rpc", "Non-interactive JSON RPC mode");

registerPackageCommands(program);

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

function normalizeThinkingLevel(level: string | undefined): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
  if (!level) return undefined;
  const normalized = level.trim().toLowerCase();
  if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(normalized)) {
    return normalized as "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  }
  return undefined;
}

function splitModelArg(modelArg: string | undefined): { provider?: string; model?: string; thinking?: string } {
  if (!modelArg) return {};
  const [rawModel, thinking] = modelArg.split(":");
  const parts = rawModel.split("/");
  if (parts.length === 2) return { provider: parts[0], model: parts[1], thinking };
  return { model: rawModel, thinking };
}


async function readPromptArg(promptParts: string[]): Promise<string> {
  const stdinChunks: Buffer[] = [];
  if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) stdinChunks.push(Buffer.from(chunk));
  }
  const stdinText = stdinChunks.length > 0 ? Buffer.concat(stdinChunks).toString("utf-8").trim() : "";
  const promptSegments = promptParts.map((part) => {
    if (!part.startsWith("@")) return part;
    const filePath = resolve(part.slice(1));
    if (!existsSync(filePath)) return part;
    try {
      return `--- @${part.slice(1)} ---\n${readFileSync(filePath, "utf-8")}`;
    } catch {
      return part;
    }
  }).filter(Boolean);
  const joinedPrompt = promptSegments.join(" ").trim();
  if (joinedPrompt && stdinText) return `${joinedPrompt}\n\n${stdinText}`;
  if (joinedPrompt) return joinedPrompt;
  if (stdinText) return stdinText;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8").trim();
}

program.action(async (promptParts, opts) => {
  clearRuntimeSettings();
  const parsedModel = splitModelArg(opts.model);
  const thinkingOverride = normalizeThinkingLevel(opts.thinking ?? parsedModel.thinking);
  if (opts.sessionDir) setRuntimeSettings({ sessionDir: opts.sessionDir });
  if (opts.session === false) setRuntimeSettings({ autoSaveSessions: false });
  if (thinkingOverride) setRuntimeSettings({ thinkingLevel: thinkingOverride, enableThinking: thinkingOverride !== "off", defaultThinkingLevel: thinkingOverride });
  if (opts.theme) setRuntimeSettings({ theme: opts.theme });
  if (opts.models) setRuntimeSettings({ enabledModels: opts.models.split(",").map((entry: string) => entry.trim()).filter(Boolean) });
  if (opts.verbose) setRuntimeSettings({ quietStartup: false, verboseStartup: true });
  if (opts.extensions === false) setRuntimeSettings({ discoverExtensions: false });
  if (opts.skills === false) setRuntimeSettings({ discoverSkills: false });
  if (opts.promptTemplates === false) setRuntimeSettings({ discoverPrompts: false });
  if (opts.themes === false) setRuntimeSettings({ discoverThemes: false });
  if (opts.extension?.length) setRuntimeSettings({ extensions: opts.extension });
  if (opts.skill?.length) setRuntimeSettings({ skills: opts.skill });
  if (opts.promptTemplate?.length) setRuntimeSettings({ prompts: opts.promptTemplate });
  if (opts.themePath?.length) setRuntimeSettings({ themes: opts.themePath });
  if (opts.apiKey) setRuntimeProviderApiKey(parsedModel.provider ?? opts.provider ?? "openai", opts.apiKey);
  const toolsDisabled = process.argv.includes("--no-tools");
  if (toolsDisabled) setRuntimeSettings({ deniedTools: [...TOOL_NAMES] });

  if (opts.export) {
    const manager = SessionManager.open(opts.export, opts.sessionDir);
    const session = manager.getSession();
    const outputPath = opts.exportOut || `${session.getId()}.html`;
    const content = buildHtmlExport(session.getMessages(), session.getProvider() || "unknown", session.getModel() || "unknown", session.getCwd());
    writeFileSync(outputPath, content, "utf-8");
    process.stdout.write(`${outputPath}\n`);
    return;
  }

  // Load extension hooks
  await ensureConfiguredPackagesInstalled();
  const hooks = loadExtensions();

  // RPC mode � non-interactive JSON I/O
  if (opts.rpc || opts.mode === "rpc") {
    await runRpcMode(hooks, opts);
    return;
  }

  const providerRegistry = new ProviderRegistry();
  const detectedProvidersOnce = await providerRegistry.refresh();

  if (opts.listModels) {
    const options = providerRegistry.buildVisibleModelOptions(null, "", getSettings().scopedModels);
    for (const option of options) {
      const id = `${option.providerId}/${option.modelId}`;
      if (!opts.listModels || id.toLowerCase().includes(String(opts.listModels).toLowerCase())) {
        process.stdout.write(`${id}\n`);
      }
    }
    return;
  }

  if (opts.mode === "text") opts.print = true;
  if (opts.tools && !toolsDisabled) {
    const requested = String(opts.tools).split(",").map((entry: string) => entry.trim()).filter(Boolean);
    const allowSet = new Set<string>();
    const denySet = new Set<string>();
    for (const entry of requested) {
      if (entry.startsWith("!") || entry.startsWith("-")) denySet.add(entry.slice(1));
      else allowSet.add(entry.startsWith("+") ? entry.slice(1) : entry);
    }
    const denied = TOOL_NAMES.filter((tool: ToolName) => (allowSet.size > 0 && !allowSet.has(tool)) || denySet.has(tool));
    setRuntimeSettings({ deniedTools: [...new Set<string>(denied)] });
  }

  if (opts.print || opts.mode === "json") {
    const prompt = await readPromptArg(promptParts);
    if (!prompt) {
      console.error("No prompt provided for single-shot mode.");
      process.exit(1);
      return;
    }
    const jsonMode = opts.mode === "json";
    const result = await runOneShotPrompt({
      prompt,
      mode: getSettings().mode,
      providers: detectedProvidersOnce,
      providerRegistry,
      opts: {
        ...opts,
        provider: parsedModel.provider ?? opts.provider,
        model: parsedModel.model ?? opts.model,
        systemPrompt: opts.systemPrompt,
        appendSystemPrompt: opts.appendSystemPrompt,
      },
      streamCallbacks: jsonMode ? {
        onStart: ({ providerId, modelId }) => process.stdout.write(JSON.stringify({ type: "start", provider: providerId, model: modelId }) + "\n"),
        onText: (delta) => process.stdout.write(JSON.stringify({ type: "text", delta }) + "\n"),
        onReasoning: (delta) => process.stdout.write(JSON.stringify({ type: "reasoning", delta }) + "\n"),
        onToolCall: ({ name, args }) => process.stdout.write(JSON.stringify({ type: "tool_call", name, args }) + "\n"),
        onToolResult: ({ name, result }) => process.stdout.write(JSON.stringify({ type: "tool_result", name, result }) + "\n"),
      } : undefined,
    });
    if (jsonMode) {
      process.stdout.write(JSON.stringify({
        type: "done",
        provider: result.providerId,
        model: result.modelId,
        usage: result.usage,
        session: {
          totalTokens: result.session.getTotalTokens(),
          inputTokens: result.session.getTotalInputTokens(),
          outputTokens: result.session.getTotalOutputTokens(),
          cost: result.session.getTotalCost(),
        },
        toolCalls: result.toolCalls,
      }) + "\n");
    } else {
      process.stdout.write(`${result.content}\n`);
    }
    return;
  }

  const app = new App();
  app.setVersion(program.version() ?? APP_VERSION);
  let currentMode: Mode = "build";
  let lastActivityTime = Date.now(); // Track for cache expiry warning

  const buildRuntimeSystemPrompt = (providerId?: string): string => {
    const base = buildSystemPrompt(process.cwd(), providerId, currentMode, getSettings().cavemanLevel ?? "off");
    if (opts.systemPrompt) return opts.systemPrompt;
    if (opts.appendSystemPrompt) return `${base}\n\n${opts.appendSystemPrompt}`;
    return base;
  };

  let systemPrompt = buildRuntimeSystemPrompt(undefined);

  // Resume or new session
  let session: Session;
  const sessionTarget = opts.sessionId;
  if (sessionTarget && getSettings().autoSaveSessions) {
    session = Session.load(sessionTarget) ?? new Session(sessionTarget);
    if (session.getMessages().length > 0) {
      for (const msg of session.getMessages()) app.addMessage(msg.role, msg.content);
    }
  } else if (opts.fork && getSettings().autoSaveSessions) {
    const base = Session.load(opts.fork);
    session = base ? base.fork() : new Session();
    if (session.getMessages().length > 0) {
      for (const msg of session.getMessages()) app.addMessage(msg.role, msg.content);
    }
  } else if ((opts.continue || opts.resume) && getSettings().autoSaveSessions) {
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
  app.setSessionName(session.getName());
  hooks.emit("on_session_start", { cwd: process.cwd() });
  app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
  void checkForNewVersion(APP_VERSION).then((update) => {
    if (update) app.setUpdateNotice(update);
  }).catch(() => {});

  // Scoped model index for Ctrl+P cycling
  let scopedModelIndex = -1;

  // Mode toggle callback
  app.onModeToggle((newMode) => {
    currentMode = newMode;
    systemPrompt = buildRuntimeSystemPrompt(activeModel?.provider?.id);
  });

  app.onCavemanToggle((level) => {
    reloadContext();
    systemPrompt = buildRuntimeSystemPrompt(activeModel?.provider?.id);
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
        rebuildSmallModelState();
        systemPrompt = buildRuntimeSystemPrompt(provId);
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

  function rebuildSmallModelState(): void {
    smallModel = null;
    smallModelId = "";
    if (!activeModel) return;
    if (activeModel.provider.id === "codex" && activeModel.runtime === "native-cli") return;
    const cheapId = getSmallModelId(activeModel.provider.id);
    if (!cheapId || cheapId === currentModelId) return;
    try {
      smallModel = providerRegistry.createModel(activeModel.provider.id, cheapId);
      smallModelId = cheapId;
    } catch {
      smallModel = null;
      smallModelId = "";
    }
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
    rebuildSmallModelState();
    systemPrompt = buildRuntimeSystemPrompt(activeModel?.provider?.id);
  })();

  const buildTools = (allowedTools: readonly ToolName[]) => ({
    ...getTools({
      include: allowedTools,
      extraTools: {
        agent: createAgentTool({
          cwd: () => process.cwd(),
          providerRegistry,
          getActiveModel: () => activeModel,
          getCurrentModelId: () => currentModelId,
        }),
      },
    }),
    askUser: createAskUserTool((request) => app.showQuestionnaire(request)),
  });

  // Wire bash streaming output to UI
  setBashOutputCallback((chunk) => {
    app.appendToolOutput(chunk);
  });

  // Wire TODO list to UI
  setTodoChangeCallback((items) => {
    app.updateTodo(items);
  });

  let drainingPending = false;
  const pendingFlushes = new Set<"steering" | "followup">();
  app.onPendingMessagesReadyHandler(async (delivery) => {
    pendingFlushes.add(delivery);
    if (drainingPending) return;
    drainingPending = true;
    try {
      while (true) {
        let batch: ReturnType<typeof app.takePendingMessages> = [];
        if (pendingFlushes.delete("steering")) {
          batch = app.takePendingMessages("steering");
        } else if (pendingFlushes.delete("followup")) {
          const steering = app.takePendingMessages("steering");
          batch = steering.length > 0 ? steering : app.takePendingMessages("followup");
        } else {
          break;
        }
        if (batch.length === 0) break;

        const combinedText = batch
          .map((entry) => entry.text.trim())
          .filter(Boolean)
          .join("\n\n");
        const combinedImages = batch.flatMap((entry) => entry.images ?? []);
        if (!combinedText && combinedImages.length === 0) continue;

        await processUserMessage(combinedText, combinedImages.length > 0 ? combinedImages : undefined);
      }
    } finally {
      drainingPending = false;
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
          app.setSessionName(nextSession.getName());
        },
        onModelChange: (nextModel, nextModelId) => {
          activeModel = nextModel;
          currentModelId = nextModelId;
          rebuildSmallModelState();
          systemPrompt = buildRuntimeSystemPrompt(nextModel.provider.id);
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
              app.setSessionName(loaded.getName());
              app.clearMessages();
              for (const msg of loaded.getMessages()) app.addMessage(msg.role, msg.content);
              app.updateUsage(loaded.getTotalCost(), loaded.getTotalInputTokens(), loaded.getTotalOutputTokens());
            }
          } else {
            session = new Session();
            app.setSessionName(session.getName());
            app.clearMessages();
            app.resetCost();
          }
          systemPrompt = buildRuntimeSystemPrompt(activeModel?.provider?.id);
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
      buildTools,
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

const normalizedArgv = process.argv.map((arg, index, argv) => {
  if (arg === "--session") return "--session-id";
  return arg;
});

program.parse(normalizedArgv);
