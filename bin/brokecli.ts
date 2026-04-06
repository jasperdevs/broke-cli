import { Command } from "commander";
import { execSync, spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { App } from "../src/tui/app.js";
import { detectProviders, pickDefault } from "../src/ai/detect.js";
import type { ModelHandle } from "../src/ai/providers.js";
import { startNativeStream } from "../src/ai/native-stream.js";
import { startStream } from "../src/ai/stream.js";
import { getContextLimit, loadPricing } from "../src/ai/cost.js";
import { buildSystemPrompt, reloadContext, resolveCavemanLevel } from "../src/core/context.js";
import { Session } from "../src/core/session.js";
import { getTools } from "../src/tools/registry.js";
import { createAskUserTool } from "../src/tools/ask.js";
import { setBashOutputCallback } from "../src/tools/bash.js";
import { setTodoChangeCallback, clearTodo } from "../src/tools/todo.js";
import { marked } from "marked";
import { checkBudget } from "../src/core/budget.js";
import { getApiKey, getModelContextLimitOverride, getProviderCredential, getSettings, updateProviderConfig, updateSetting, type Settings, type Mode } from "../src/core/config.js";
import { compactMessages, getTotalContextTokens } from "../src/core/compact.js";
import { undoLastCheckpoint } from "../src/core/git.js";
import { listTemplates, loadTemplate } from "../src/core/templates.js";
import { loadExtensions } from "../src/core/extensions.js";
import { RESET, DIM, RED, GREEN } from "../src/utils/ansi.js";
import { routeMessage, getSmallModelId } from "../src/ai/router.js";
import { estimateTextTokens } from "../src/ai/tokens.js";
import { listThemes, setPreviewTheme } from "../src/core/themes.js";
import { ProviderRegistry, LOCAL_PROVIDER_DEFAULTS } from "../src/ai/provider-registry.js";
import { runRpcMode } from "../src/cli/rpc.js";

const program = new Command()
  .name("brokecli")
  .description("AI coding CLI that doesn't waste your money")
  .version("0.0.1")
  .option("--broke", "Route to cheapest capable model")
  .option("-m, --model <model>", "Model to use (provider/model-id)")
  .option("-c, --continue", "Continue last session")
  .option("-p, --print", "Single-shot mode: print response and exit")
  .option("--rpc", "Non-interactive JSON RPC mode");

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));

function getNotificationIconPath(): string | null {
  const candidates = [
    join(process.cwd(), "logos", "brokecli-square-1024.png"),
    join(RUNTIME_DIR, "..", "logos", "brokecli-square-1024.png"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

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

function resolveWindowsPowerShell(): string {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const candidates = [
    `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    "powershell.exe",
    "pwsh.exe",
  ];
  return candidates.find((candidate) => candidate.includes("\\") ? existsSync(candidate) : true) ?? "powershell.exe";
}

function sendResponseNotification(message = "Response complete"): void {
  try {
    const iconPath = getNotificationIconPath();
    if (process.platform === "win32") {
      const script = `
$shown = $false
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $icon = New-Object System.Windows.Forms.NotifyIcon
  $iconObj = $null
  if ('${(iconPath ?? "").replace(/\\/g, "\\\\").replace(/'/g, "''")}') {
    try {
      $bitmap = New-Object System.Drawing.Bitmap '${(iconPath ?? "").replace(/\\/g, "\\\\").replace(/'/g, "''")}'
      $iconObj = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
    } catch {}
  }
  if ($iconObj -eq $null) {
    $iconObj = [System.Drawing.SystemIcons]::Information
  }
  $icon.Icon = $iconObj
  $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $icon.BalloonTipTitle = 'BrokeCLI'
  $icon.BalloonTipText = '${message.replace(/'/g, "''")}'
  $icon.Visible = $true
  $icon.ShowBalloonTip(4000)
  $end = (Get-Date).AddMilliseconds(4500)
  while ((Get-Date) -lt $end) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 50
  }
  $icon.Dispose()
  $shown = $true
} catch {}
if (-not $shown) {
  try {
    Start-Process msg.exe -ArgumentList '*', 'BrokeCLI: ${message.replace(/'/g, "''")}' -WindowStyle Hidden
    $shown = $true
  } catch {}
}
if (-not $shown) {
  try { [System.Media.SystemSounds]::Exclamation.Play(); $shown = $true } catch {}
}
if (-not $shown) {
  try { [console]::beep(880, 220) } catch {}
}
try { [console]::write([char]7) } catch {}
`;
      const child = spawn(resolveWindowsPowerShell(), [
        "-NoProfile",
        "-Sta",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-Command", script,
      ], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return;
  }

    if (process.platform === "darwin") {
      const script = `display notification "${message.replace(/"/g, '\\"')}" with title "BrokeCLI"`;
      const child = spawn("osascript", [
        "-e",
        script,
      ], { detached: true, stdio: "ignore" });
      child.unref();
      return;
    }

    const notifyArgs = iconPath
      ? ["--icon", iconPath, "BrokeCLI", message]
      : ["BrokeCLI", message];
    const child = spawn("notify-send", notifyArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // ignore notification failures
  }
}

const CONNECT_PROVIDER_ORDER = [
  "codex",
  "anthropic",
  "openai",
  "google",
  "groq",
  "mistral",
  "xai",
  "openrouter",
  "ollama",
  "lmstudio",
  "llamacpp",
  "jan",
  "vllm",
] as const;

function getNativeCliLabel(providerId: string): string {
  if (providerId === "anthropic") return "Claude Code";
  if (providerId === "codex") return "Codex";
  return "native provider";
}

function canUseSdkTools(model: ModelHandle): boolean {
  return model.runtime === "sdk"
    && !!model.model
    && ["anthropic", "openai", "codex", "google", "mistral", "groq", "xai", "openrouter"].includes(model.provider.id);
}

async function compactForModel(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: ModelHandle,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (model.runtime === "sdk" && model.model) {
    return compactMessages(messages, model.model);
  }
  return messages.slice(-6);
}

function formatRelativeMinutes(updatedAt: number): string {
  const ago = Math.max(0, Math.floor((Date.now() - updatedAt) / 60000));
  if (ago < 1) return "now";
  if (ago < 60) return `${ago}m ago`;
  if (ago < 1440) return `${Math.floor(ago / 60)}h ago`;
  return `${Math.floor(ago / 1440)}d ago`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function buildMarkdownExport(msgs: ReturnType<Session["getMessages"]>, providerName: string, modelName: string, cwd: string): string {
  const header = [
    "# BrokeCLI Transcript",
    "",
    `- Exported: ${formatTimestamp(Date.now())}`,
    `- Model: ${providerName}/${modelName}`,
    `- Directory: \`${cwd}\``,
    "",
  ];
  const body = msgs.map((m) => {
    const title = m.role.charAt(0).toUpperCase() + m.role.slice(1);
    return `## ${title}\n\n_Time: ${formatTimestamp(m.timestamp)}_\n\n${m.content}\n`;
  });
  return [...header, ...body].join("\n");
}

function buildHtmlExport(msgs: ReturnType<Session["getMessages"]>, providerName: string, modelName: string, cwd: string): string {
  const cards = msgs.map((m) => {
    const rendered = m.role === "assistant"
      ? marked.parse(m.content) as string
      : `<pre>${escapeHtml(m.content)}</pre>`;
    return `<article class="message ${m.role}">
<header>
  <span class="role">${escapeHtml(m.role)}</span>
  <time>${escapeHtml(formatTimestamp(m.timestamp))}</time>
</header>
<div class="content">${rendered}</div>
</article>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BrokeCLI Transcript</title>
<style>
:root {
  --bg: #0b0b0b;
  --panel: #121212;
  --panel-soft: #1e1e1e;
  --border: #2a2a2a;
  --text: #f3f3f3;
  --muted: #8a8a8a;
  --green: #3ac73a;
  --green-soft: #183118;
  --gray-bubble: #2a2a32;
  --shadow: 0 20px 80px rgba(0,0,0,.35);
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
body { padding: 32px 20px 64px; }
.shell {
  max-width: 980px;
  margin: 0 auto;
  border: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,0)) , var(--panel);
  box-shadow: var(--shadow);
}
.meta {
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
  display: grid;
  gap: 6px;
}
.meta h1 { margin: 0; font-size: 15px; color: var(--green); }
.meta-row { color: var(--muted); font-size: 12px; }
.transcript { padding: 18px; display: grid; gap: 14px; }
.message {
  border: 1px solid var(--border);
  background: var(--panel-soft);
}
.message header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: .08em;
}
.message.user {
  background: var(--gray-bubble);
}
.message.assistant {
  border-color: #214121;
}
.message.assistant .role {
  color: var(--green);
}
.message.system {
  background: #151515;
}
.content {
  padding: 16px 18px;
  line-height: 1.6;
  white-space: normal;
}
.content pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.content code {
  background: #171717;
  border: 1px solid #2b2b2b;
  padding: .12rem .35rem;
}
.content pre code {
  display: block;
  padding: 14px;
  overflow-x: auto;
}
.content p:first-child { margin-top: 0; }
.content p:last-child { margin-bottom: 0; }
.content a { color: #8fd48f; }
.content blockquote {
  margin: 0;
  padding-left: 12px;
  border-left: 2px solid #2c5d2c;
  color: #b9d8b9;
}
</style>
</head>
<body>
<main class="shell">
  <section class="meta">
    <h1>BrokeCLI Transcript</h1>
    <div class="meta-row">Model: ${escapeHtml(providerName)}/${escapeHtml(modelName)}</div>
    <div class="meta-row">Directory: ${escapeHtml(cwd)}</div>
    <div class="meta-row">Exported: ${escapeHtml(formatTimestamp(Date.now()))}</div>
  </section>
  <section class="transcript">
    ${cards}
  </section>
</main>
</body>
</html>`;
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
  let currentMode: Mode = getSettings().mode;
  let systemPrompt = buildSystemPrompt(process.cwd(), undefined, currentMode, getSettings().cavemanLevel ?? "off");
  let lastActivityTime = Date.now(); // Track for cache expiry warning
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
  let providers: Awaited<ReturnType<typeof detectProviders>> = [];
  let activeModel: ModelHandle | null = null;
  let smallModel: ModelHandle | null = null;
  let currentModelId = "";
  let smallModelId = "";
  let lastToolCalls: string[] = [];

  async function refreshProviderState(): Promise<void> {
    providers = await providerRegistry.refresh();
    app.setDetectedProviders(providers.map((p) => p.name));
  }

  function buildVisibleModelOptions(): Array<{ providerId: string; providerName: string; modelId: string; active: boolean }> {
    return providerRegistry.buildVisibleModelOptions(activeModel, currentModelId, getSettings().scopedModels);
  }

  async function runConnectFlow(providerId?: string): Promise<void> {
    const selectedProviderId = providerId ?? await new Promise<string>((resolve) => {
      const items = CONNECT_PROVIDER_ORDER
        .map((id) => providerRegistry.getProviderInfo(id))
        .filter((info): info is NonNullable<typeof info> => !!info)
        .map((info) => ({
          id: info.id,
          label: info.name,
          detail: providerRegistry.getConnectStatus(info.id),
        }));
      app.openItemPicker("Connect Provider", items, resolve);
    });

    const info = providerRegistry.getProviderInfo(selectedProviderId);
    if (!info) {
      app.addMessage("system", `Unknown provider: ${selectedProviderId}`);
      return;
    }

    const discoveredCredential = getProviderCredential(selectedProviderId);

    if (discoveredCredential.kind === "native_oauth") {
      updateProviderConfig(selectedProviderId, { disabled: false });
      await refreshProviderState();
      if (providers.some((p) => p.id === selectedProviderId)) {
        app.addMessage("system", `Connected ${getNativeCliLabel(selectedProviderId)} using existing native login${discoveredCredential.source ? ` from ${discoveredCredential.source}` : ""}.`);
      } else {
        app.addMessage("system", `Found ${getNativeCliLabel(selectedProviderId)} login, but the native CLI is not available on PATH yet.`);
      }
      return;
    }

    if (selectedProviderId in LOCAL_PROVIDER_DEFAULTS) {
      const defaultBaseUrl = LOCAL_PROVIDER_DEFAULTS[selectedProviderId];
      const savedBaseUrl = providerRegistry.getSavedBaseUrl(selectedProviderId);
      const baseUrlOptions = savedBaseUrl && savedBaseUrl !== defaultBaseUrl
        ? ["use default", "use saved", "custom"]
        : ["use default", "custom"];
      const entered = (await app.showQuestion(`Base URL for ${info.name}`, baseUrlOptions))?.trim() ?? "";
      let baseUrl = defaultBaseUrl;
      if (isSkippedPromptAnswer(entered)) {
        app.addMessage("system", "Connect cancelled.");
        return;
      }
      if (entered === "use default") {
        baseUrl = defaultBaseUrl;
      } else if (entered === "use saved" && savedBaseUrl) {
        baseUrl = savedBaseUrl;
      } else if (entered === "custom") {
        const custom = (await app.showQuestion(`Enter ${info.name} base URL`, undefined)).trim();
        if (isSkippedPromptAnswer(custom)) {
          app.addMessage("system", "Connect cancelled.");
          return;
        }
        if (!isValidHttpBaseUrl(custom)) {
          app.addMessage("system", `Invalid base URL: ${custom}`);
          return;
        }
        baseUrl = custom;
      } else if (entered && entered !== defaultBaseUrl) {
        if (!isValidHttpBaseUrl(entered)) {
          app.addMessage("system", `Invalid base URL: ${entered}`);
          return;
        }
        baseUrl = entered;
      }
      updateProviderConfig(selectedProviderId, { baseUrl, disabled: false });
      await refreshProviderState();
      if (providers.some((p) => p.id === selectedProviderId)) {
        app.addMessage("system", `Connected ${info.name} at ${baseUrl}.`);
      } else {
        app.addMessage("system", `${info.name} saved at ${baseUrl}, but it is not responding yet.`);
      }
      return;
    }

    if (discoveredCredential.kind === "api_key") {
      updateProviderConfig(selectedProviderId, { disabled: false });
      await refreshProviderState();
      app.addMessage("system", `Connected ${info.name} using existing credentials${discoveredCredential.source ? ` from ${discoveredCredential.source}` : ""}.`);
      return;
    }

    const apiKey = (await app.showQuestion(`Paste ${info.name} API key`, undefined)).trim();
    if (isSkippedPromptAnswer(apiKey)) {
      app.addMessage("system", "Connect cancelled.");
      return;
    }
    updateProviderConfig(selectedProviderId, { apiKey, disabled: false });
    await refreshProviderState();
    if (providers.some((p) => p.id === selectedProviderId)) {
      app.addMessage("system", `Connected ${info.name}.`);
    } else {
      app.addMessage("system", `${info.name} credentials saved, but detection has not confirmed access yet.`);
    }
  }

  const initPromise = (async () => {
    await loadPricing();
    await refreshProviderState();

    let providerId: string | undefined;
    let modelId: string | undefined;

    if (opts.broke) {
      // --broke flag: use the cheapest available model
      const def = pickDefault(providers);
      if (def) {
        providerId = def.id;
        modelId = getSmallModelId(def.id);
      }
    } else if (opts.model) {
      const slashIdx = opts.model.indexOf("/");
      if (slashIdx > 0) {
        providerId = opts.model.slice(0, slashIdx);
        modelId = opts.model.slice(slashIdx + 1);
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
        const slashIdx = lastModel.indexOf("/");
        if (slashIdx > 0) {
          providerId = lastModel.slice(0, slashIdx);
          modelId = lastModel.slice(slashIdx + 1);
        }
      }
      if (!providerId) {
        const def = pickDefault(providers);
        if (!def) {
          app.addMessage("system", "No providers found. Run /connect, set an API key, or start a local model server.");
          return;
        }
        providerId = def.id;
      }
    }

    try {
      activeModel = providerRegistry.createModel(providerId!, modelId);
      currentModelId = modelId ?? activeModel.provider.defaultModel;
      systemPrompt = buildSystemPrompt(process.cwd(), providerId!, currentMode, getSettings().cavemanLevel ?? "off");
      app.setModel(activeModel.provider.name, currentModelId);
      app.setMode(currentMode);
      session.setProviderModel(activeModel.provider.name, currentModelId);
      // Save as last used model
      updateSetting("lastModel", `${activeModel.provider.id}/${currentModelId}`);
      // Auto-create small model for cost routing
      const cheapId = getSmallModelId(activeModel.provider.id);
      if (cheapId && cheapId !== currentModelId) {
        try {
          smallModel = providerRegistry.createModel(activeModel.provider.id, cheapId);
          smallModelId = cheapId;
        } catch { /* no small model available */ }
      }
      app.clearStatus();
    } catch (err) {
      app.addMessage("system", `Failed to init ${providerId}: ${(err as Error).message}`);
    }
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
    let commandRewrittenText: string | null = null;
    if (text.startsWith("/")) {
      const [cmd] = text.slice(1).split(" ");
      switch (cmd) {
        case "btw": {
          const sideQuestion = text.slice(5).trim();
          if (!sideQuestion) {
            app.addMessage("system", "Usage: /btw <side question>");
            return;
          }
          session = session.fork();
          if (activeModel) session.setProviderModel(activeModel.provider.name, currentModelId);
          app.addMessage("system", "Forked session for /btw.");
          commandRewrittenText = sideQuestion;
          break;
        }
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
          await runConnectFlow();
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
        case "notify": {
          sendResponseNotification("Test notification");
          app.addMessage("system", "Notification test sent.");
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
            const compacted = await compactForModel(chatMsgs, activeModel);
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

    if (commandRewrittenText) {
      text = commandRewrittenText;
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

    // Cache expiry warning — 5 min idle = full price on API
    const idleMs = Date.now() - lastActivityTime;
    if (idleMs > 5 * 60 * 1000 && session.getChatMessages().length > 4) {
      const idleMins = Math.floor(idleMs / 60000);
      app.setStatus(`${DIM}idle ${idleMins}m — context cache likely expired, consider /compact${RESET}`);
    }
    lastActivityTime = Date.now();

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
    const ctxTokens = getTotalContextTokens(chatMsgs, systemPrompt, currentModelId);
    const contextLimit = getModelContextLimitOverride(activeModel.provider.id, currentModelId)
      ?? getContextLimit(currentModelId, activeModel?.provider.id)
      ?? 128000;
    const ctxPct = contextLimit > 0 ? Math.min(100, Math.round((ctxTokens / contextLimit) * 100)) : 0;
    app.setContextUsage(ctxTokens, contextLimit);

    // Auto-compact if context > 80%
    if (ctxPct > 80 && chatMsgs.length > 8) {
      try {
        app.setCompacting(true, ctxTokens);
        const compacted = await compactForModel(chatMsgs, activeModel);
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
    clearTodo();
    let streamedText = "";
    let streamedReasoning = "";
    getContextOptimizer().nextTurn();

    // Smart model routing — pick cheap model for simple tasks
    const route = smallModel && getSettings().autoRoute
      ? routeMessage(text, session.getChatMessages().length, lastToolCalls)
      : "main" as const;
    const useModel = route === "small" && smallModel ? smallModel : activeModel;
    const useModelId = route === "small" && smallModel ? smallModelId : currentModelId;
    lastToolCalls = [];

    // Optimize context — evict old tool results, compress history
    const optimizedMessages = getContextOptimizer().optimizeMessages(session.getChatMessages());

    abortController = new AbortController();
    app.onAbortRequest(() => {
      abortController?.abort();
      app.setStreaming(false);
      app.addMessage("system", "Cancelled.");
      abortController = null;
    });

    const configuredCavemanLevel = getSettings().cavemanLevel ?? "off";
    const effectiveCavemanLevel = resolveCavemanLevel(configuredCavemanLevel, text);
    const turnSystemPrompt = buildSystemPrompt(process.cwd(), useModel.provider.id, currentMode, effectiveCavemanLevel);

    const streamCallbacks = {
      onText: (delta: string) => {
        app.appendToLastMessage(delta);
        streamedText += delta;
        app.setStreamTokens(estimateTextTokens(streamedText + streamedReasoning, useModelId));
      },
      onReasoning: (delta: string) => {
        app.appendThinking(delta);
        streamedReasoning += delta;
        app.setStreamTokens(estimateTextTokens(streamedText + streamedReasoning, useModelId));
      },
      onFinish: (usage: { inputTokens: number; outputTokens: number; cost: number }) => {
        const content = app.getLastAssistantContent();
        if (content) {
          session.addMessage("assistant", content);
        } else {
          session.addMessage("assistant", "[empty response]");
          app.addMessage("system", `${DIM}No response from model. Try again or switch models with /model.${RESET}`);
        }
        session.addUsage(usage.inputTokens, usage.outputTokens, usage.cost);
        app.setStreaming(false);
        app.updateUsage(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
        abortController = null;
        lastActivityTime = Date.now();
        if (getSettings().notifyOnResponse) {
          sendResponseNotification();
        }
      },
      onError: (err: Error) => {
        let msg = err.message;
        const data = (err as any).data;
        if (data?.error?.message) msg = data.error.message;
        if (msg.includes("insufficient permissions") || msg.includes("Missing scopes")) {
          msg = `Your API key doesn't have access to this model. Try a different model with /model.`;
        } else if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key") || msg.includes("401")) {
          msg = `Invalid API key for ${activeModel?.provider.name ?? "this provider"}. Check your key and try again.`;
        } else if (msg.includes("Could not resolve") || msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
          msg = `Can't reach ${activeModel?.provider.name ?? "the provider"}. Check your connection or if the server is running.`;
        } else if (msg.includes("429") || msg.includes("rate_limit") || msg.includes("hit your limit")) {
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
      onAfterResponse: () => {
        const settings = getSettings();
        if (settings.followUpMode === "after_response" && app.hasPendingMessages()) {
          app.flushPendingMessages();
        }
      },
    };

    if (useModel.runtime === "native-cli") {
      await startNativeStream(
        {
          providerId: useModel.provider.id as "anthropic" | "codex",
          modelId: useModelId,
          system: turnSystemPrompt,
          messages: optimizedMessages,
          abortSignal: abortController.signal,
          enableThinking: route === "main" ? getSettings().enableThinking : false,
          thinkingLevel: getSettings().thinkingLevel || "low",
          yoloMode: getSettings().yoloMode,
          cwd: process.cwd(),
        },
        streamCallbacks,
      );
    } else {
      await startStream(
        {
          model: useModel.model!,
          modelId: useModelId,
          providerId: useModel.provider.id,
          system: turnSystemPrompt,
          messages: optimizedMessages,
          tools: canUseSdkTools(useModel) ? tools : undefined,
          abortSignal: abortController.signal,
          enableThinking: route === "main" ? getSettings().enableThinking : false,
          thinkingLevel: getSettings().thinkingLevel || "low",
        },
        {
          ...streamCallbacks,
          onToolCallStart: (name) => {
            if (name === "todoWrite") return;
            app.addToolCall(name, "...");
          },
          onToolCall: (name, args) => {
            hooks.emit("on_tool_call", { name, args });
            lastToolCalls.push(name);
            if (name === "todoWrite") return;
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
            app.updateToolCallArgs(name, preview, args);
          },
          onToolResult: (_name, result) => {
            hooks.emit("on_tool_result", { name: _name, result });
            if (_name === "todoWrite") return;
            const r = result as { success?: boolean; output?: string; error?: string; content?: string; matches?: unknown[]; files?: string[] };
            let detail: string | undefined;
            if (_name === "bash" && r.output) {
              detail = r.output.slice(0, 200);
            } else if (_name === "readFile" && r.content) {
              const lineCount = r.content.split("\n").length;
              detail = `${lineCount} lines`;
              const readPath = (result as any)?.path ?? "";
              if (readPath) getContextOptimizer().trackFileRead(readPath, lineCount);
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
            const settings = getSettings();
            if (settings.followUpMode === "after_tool" && app.hasPendingMessages()) {
              app.flushPendingMessages();
            }
          },
        },
      );
    }
  }

// Close the program.action callback
});

program.parse();
