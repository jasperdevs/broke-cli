import { execSync } from "child_process";
import { App } from "../src/tui/app.js";
import type { DetectedProvider } from "../src/ai/detect.js";
import type { ModelHandle } from "../src/ai/providers.js";
import { buildSystemPrompt, reloadContext } from "../src/core/context.js";
import { Session } from "../src/core/session.js";
import { SessionManager } from "../src/core/session-manager.js";
import { touchProject } from "../src/core/projects.js";
import { getTools, TOOL_NAMES, type ToolName } from "../src/tools/registry.js";
import { setBashOutputCallback } from "../src/tools/bash.js";
import { setTodoChangeCallback } from "../src/tools/todo.js";
import { getSettings, updateSetting, type Mode } from "../src/core/config.js";
import { clearRuntimeSettings, setRuntimeSettings } from "../src/core/config.js";
import { getApiKey, setRuntimeProviderApiKey } from "../src/core/provider-credentials.js";
import { loadExtensions } from "../src/core/extensions.js";
import { APP_VERSION } from "../src/core/app-meta.js";
import { ProviderRegistry } from "../src/ai/provider-registry.js";
import { runRpcMode } from "../src/cli/rpc.js";
import { resolveOneShotModel, runOneShotPrompt } from "../src/cli/oneshot.js";
import { bootstrapSession } from "../src/cli/session-bootstrap.js";
import { runModelTurn } from "../src/cli/turn-runner.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { createProgram } from "../src/cli/program.js";
import { ensureConfiguredPackagesInstalledWithOptions, type PackageInstallFailure } from "../src/core/package-manager.js";
import { checkForNewVersion } from "../src/core/update.js";
import { isSkippedPromptAnswer, isValidHttpBaseUrl, normalizeThinkingLevel, normalizeProgramArgv, readPromptArg, splitModelArg } from "../src/cli/cli-helpers.js";
import { resolveConfiguredModelHandle, resolvePreferredMode, type SpecialistModelRole } from "../src/cli/model-routing.js";
import { buildVisibleRuntimeModelOptions, rebuildSmallModelState as computeSmallModelState, resolveSpecialistRuntimeModel } from "../src/cli/runtime-models.js";
import { getTurnPolicy } from "../src/core/turn-policy.js";
import { runBtwQuestion as runBtwQuestionRuntime } from "../src/cli/btw-runtime.js";
import { applyProgramRuntimeSettings, applyRuntimeToolSelection, runExportMode } from "../src/cli/program-runtime.js";
const program = createProgram(APP_VERSION);

function formatPackageInstallWarning(failure: PackageInstallFailure): string {
  const error = failure.error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
  const detail = String(error.stderr || error.stdout || error.message || failure.error).trim().split(/\r?\n/)[0] ?? "unknown error";
  return `Configured package ${failure.entry.source} could not be installed; continuing without it. ${detail}`;
}

program.action(async (promptParts, opts) => {
  const parsedModel = splitModelArg(opts.model);
  const thinkingOverride = normalizeThinkingLevel(opts.thinking ?? parsedModel.thinking);
  applyProgramRuntimeSettings(opts, parsedModel, thinkingOverride);
  const toolsDisabled = process.argv.includes("--no-tools");

  if (opts.export) {
    runExportMode(opts.export, opts.sessionDir, opts.exportOut);
    return;
  }

  const packageInstallWarnings: string[] = [];
  await ensureConfiguredPackagesInstalledWithOptions({
    throwOnFailure: false,
    onFailure: (failure) => packageInstallWarnings.push(formatPackageInstallWarning(failure)),
  });
  const hooks = loadExtensions();

  const reportPackageInstallWarnings = () => {
    for (const warning of packageInstallWarnings) process.stderr.write(`${warning}\n`);
  };

  if (opts.rpc || opts.mode === "rpc") {
    reportPackageInstallWarnings();
    await runRpcMode(hooks, opts);
    return;
  }

  const providerRegistry = new ProviderRegistry();
  const detectedProvidersOnce = await providerRegistry.refresh();

  if (opts.listModels) {
    reportPackageInstallWarnings();
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
  applyRuntimeToolSelection(opts.tools, toolsDisabled);

  if (opts.print || opts.mode === "json") {
    reportPackageInstallWarnings();
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
        provider: opts.provider ?? parsedModel.provider,
        model: opts.provider ? opts.model : (parsedModel.model ?? opts.model),
        systemPrompt: opts.systemPrompt,
        appendSystemPrompt: opts.appendSystemPrompt,
      },
      extraTools: hooks.getTools(),
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
  let currentMode: Mode = getSettings().mode;
  let lastActivityTime = Date.now(); // Track for cache expiry warning

  const buildRuntimeSystemPrompt = (providerId?: string, cavemanLevel = getSettings().cavemanLevel ?? "off"): string => {
    const base = buildSystemPrompt(process.cwd(), providerId, currentMode, cavemanLevel);
    if (opts.systemPrompt) return opts.systemPrompt;
    if (opts.appendSystemPrompt) return `${base}\n\n${opts.appendSystemPrompt}`;
    return base;
  };

  let systemPrompt = buildRuntimeSystemPrompt(undefined);

  const applyMode = (nextMode: Mode, options?: { status?: string }) => {
    if (currentMode === nextMode) {
      if (options?.status) app.setStatus(options.status);
      return;
    }
    currentMode = nextMode;
    app.setMode(nextMode);
    systemPrompt = buildRuntimeSystemPrompt(activeModel?.provider?.id);
    if (options?.status) app.setStatus(options.status);
  };

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
  for (const warning of packageInstallWarnings) app.addMessage("system", warning);
  app.setSessionName(session.getName());
  hooks.emit("on_session_start", { cwd: process.cwd() });
  app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
  void checkForNewVersion(APP_VERSION).then((update) => update && app.setStatus(`Update available: v${update.latestVersion}. ${update.command ? "Run /update to install it." : update.instruction}`)).catch(() => {});

  let scopedModelIndex = -1;

  app.onModeToggle((newMode) => {
    applyMode(newMode);
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
    const next = computeSmallModelState(providerRegistry, activeModel, currentModelId);
    smallModel = next.smallModel;
    smallModelId = next.smallModelId;
  }

  function resolveSpecialistModel(role: SpecialistModelRole): { model: ModelHandle; modelId: string } | null {
    return resolveSpecialistRuntimeModel(providerRegistry, activeModel, currentModelId, role);
  }

  function buildVisibleModelOptions(): Array<{ providerId: string; providerName: string; modelId: string; active: boolean; badges?: string[] }> {
    return buildVisibleRuntimeModelOptions(providerRegistry, activeModel, currentModelId, providers);
  }

  async function runBtwQuestion(question: string): Promise<void> {
    if (!activeModel) {
      app.setStatus("No provider configured. Run /connect.");
      return;
    }

    const configured = resolveConfiguredModelHandle(providerRegistry, activeModel, currentModelId, "btw");
    const btwModel = configured?.model ?? activeModel;
    const btwModelId = configured?.modelId ?? currentModelId;
    await runBtwQuestionRuntime({
      session,
      question,
      activeModel,
      currentModelId,
      model: btwModel,
      modelId: btwModelId,
      buildRuntimeSystemPrompt,
      onUsage: (usage) => {
        session.addUsage(usage.inputTokens, usage.outputTokens, usage.cost);
        app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
      },
      app,
    });
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
      extraTools: hooks.getTools(),
    }),
  });

  setBashOutputCallback((chunk) => {
    app.appendToolOutput(chunk);
  });

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
        onModeChange: (nextMode) => {
          applyMode(nextMode);
        },
        onModelRoutingChange: () => {
          rebuildSmallModelState();
        },
        onSystemPromptChange: (nextSystemPrompt) => {
          systemPrompt = nextSystemPrompt;
        },
        onBtw: async (question) => {
          await runBtwQuestion(question);
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
    const modeSwitching = getSettings().modeSwitching;
    if (modeSwitching !== "manual") {
      const preferredMode = resolvePreferredMode(text, getTurnPolicy(text, lastToolCalls).archetype, currentMode);
      if (preferredMode) {
        let shouldSwitch = modeSwitching === "auto";
        if (!shouldSwitch && modeSwitching === "ask") {
          const answer = await app.showQuestion(`Switch to ${preferredMode.mode} mode for this turn?`, ["Switch", "Stay"]);
          shouldSwitch = answer === "Switch";
        }
        if (shouldSwitch) {
          applyMode(preferredMode.mode, { status: `Mode: ${preferredMode.mode} - ${preferredMode.reason}` });
        }
      }
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
      resolveSpecialistModel,
    });
    lastToolCalls = turnResult.lastToolCalls;
    lastActivityTime = turnResult.lastActivityTime;
  }

});

program.parse(normalizeProgramArgv(process.argv));
