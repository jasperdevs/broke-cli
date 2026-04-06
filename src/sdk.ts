import { chdir } from "process";
import { ProviderRegistry } from "./ai/provider-registry.js";
import { Session } from "./core/session.js";
import { clearRuntimeSettings, setRuntimeProviderApiKey, setRuntimeSettings, type Mode } from "./core/config.js";
import { SessionManager } from "./core/session-manager.js";
import { SettingsManager } from "./core/settings-manager.js";
import { runOneShotPrompt, type OneShotResult } from "./cli/oneshot.js";
import { ensureConfiguredPackagesInstalled } from "./core/package-manager.js";

export interface CreateRuntimeOptions {
  cwd?: string;
  provider?: string;
  model?: string;
  mode?: Mode;
  sessionId?: string;
  sessionDir?: string;
  autoSaveSessions?: boolean;
  apiKey?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
}

export class AgentSessionRuntime {
  readonly providerRegistry: ProviderRegistry;
  session: Session;
  readonly settingsManager: SettingsManager;
  readonly sessionManager: SessionManager;
  readonly mode: Mode;
  readonly cwd: string;
  readonly provider?: string;
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly appendSystemPrompt?: string;

  constructor(options: CreateRuntimeOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.mode = options.mode ?? "build";
    this.provider = options.provider;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.appendSystemPrompt = options.appendSystemPrompt;
    this.providerRegistry = new ProviderRegistry();
    this.settingsManager = options.settingsManager ?? SettingsManager.create();
    if (options.sessionDir) setRuntimeSettings({ sessionDir: options.sessionDir });
    if (options.autoSaveSessions === false) setRuntimeSettings({ autoSaveSessions: false });
    if (options.apiKey) setRuntimeProviderApiKey(this.provider ?? "openai", options.apiKey);
    this.sessionManager = options.sessionManager
      ?? (options.autoSaveSessions === false ? SessionManager.inMemory(this.cwd) : SessionManager.create(this.cwd, options.sessionDir));
    this.session = options.sessionId
      ? (Session.load(options.sessionId) ?? new Session(options.sessionId))
      : this.sessionManager.getSession();
  }

  async prompt(text: string): Promise<OneShotResult> {
    const previous = process.cwd();
    chdir(this.cwd);
    try {
      await ensureConfiguredPackagesInstalled();
      const providers = await this.providerRegistry.refresh();
      const result = await runOneShotPrompt({
        prompt: text,
        mode: this.mode,
        providers,
        providerRegistry: this.providerRegistry,
        opts: {
          provider: this.provider,
          model: this.model,
          systemPrompt: this.systemPrompt,
          appendSystemPrompt: this.appendSystemPrompt,
        },
      });
      this.session = result.session;
      return result;
    } finally {
      chdir(previous);
    }
  }

  newSession(): Session {
    this.session = new Session();
    return this.session;
  }

  continueRecent(): Session {
    this.session = SessionManager.continueRecent(this.cwd, this.sessionManager.getSessionDir()).getSession();
    return this.session;
  }

  switchSession(id: string): Session {
    this.session = Session.load(id) ?? new Session(id);
    return this.session;
  }

  fork(id?: string): Session {
    if (id) this.switchSession(id);
    this.session = this.session.fork();
    return this.session;
  }

  listSessions(limit = 20, query = "") {
    return Session.listRecent(limit, query, this.cwd);
  }

  listAllSessions() {
    return SessionManager.listAll(this.cwd, this.sessionManager.getSessionDir());
  }
}

export function createAgentSessionRuntime(options: CreateRuntimeOptions = {}): AgentSessionRuntime {
  return new AgentSessionRuntime(options);
}

export function createAgentSession(options: CreateRuntimeOptions = {}): Session {
  return createAgentSessionRuntime(options).session;
}

export async function runPrintMode(options: CreateRuntimeOptions & { prompt: string }): Promise<string> {
  clearRuntimeSettings();
  const runtime = createAgentSessionRuntime(options);
  const result = await runtime.prompt(options.prompt);
  return result.content;
}

export async function runJsonMode(options: CreateRuntimeOptions & { prompt: string }): Promise<OneShotResult> {
  clearRuntimeSettings();
  const runtime = createAgentSessionRuntime(options);
  return runtime.prompt(options.prompt);
}

export { Session };
export { SessionManager } from "./core/session-manager.js";
export { SettingsManager } from "./core/settings-manager.js";
