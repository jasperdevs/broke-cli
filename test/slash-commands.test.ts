import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Session } from "../src/core/session.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { getCredentials, saveCredentials } from "../src/core/auth.js";
import { loadConfig, updateProviderConfig, updateSetting } from "../src/core/config.js";

function createAppStub() {
  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
  return {
    messages,
    cleared: false,
    costReset: false,
    stopped: false,
    addMessage(role: "user" | "assistant" | "system", content: string) {
      messages.push({ role, content });
    },
    clearMessages() {
      this.cleared = true;
      messages.length = 0;
    },
    resetCost() {
      this.costReset = true;
    },
    setModel() {},
    setSessionName() {},
    setDraft() {},
    updateUsage() {},
    openModelPicker() {},
    openSettings() {},
    updateSettings() {},
    openItemPicker() {},
    stop() {
      this.stopped = true;
    },
    cycleCavemanMode() {},
    cycleThinkingMode() {},
    getLastAssistantContent() {
      return "";
    },
    getFileContexts() {
      return new Map<string, string>();
    },
    async showQuestion() {
      return "";
    },
    runExternalCommand() {
      return 0;
    },
    openBudgetView() {},
    openAgentRunsView() {},
    getAgentRuns() {
      return [];
    },
  };
}

const localTemplateDir = join(process.cwd(), ".brokecli", "prompts");
const templatePath = join(localTemplateDir, "slash-test-template.md");
const configPath = join(homedir(), ".brokecli", "config.json");
const authPath = join(homedir(), ".brokecli", "auth.json");
const extDir = join(homedir(), ".brokecli", "extensions");
const extPath = join(extDir, "slash-test-extension.js");

afterEach(() => {
  if (existsSync(templatePath)) rmSync(templatePath, { force: true });
  if (existsSync(extPath)) rmSync(extPath, { force: true });
  updateSetting("disabledExtensions", (loadConfig().settings?.disabledExtensions ?? []).filter((entry) => entry !== "slash-test-extension"));
});

describe("slash command handling", () => {
  it("supports tree labels and labeled-only filtering", () => {
    const session = new Session(`test-tree-labels-${Date.now()}`);
    session.addMessage("user", "first prompt");
    session.addMessage("assistant", "first answer");
    const entryId = session.getTreeItems("all")[0]?.id;
    expect(entryId).toBeTruthy();
    session.toggleLabel(entryId!);
    const labeled = session.getTreeItems("labeled-only");
    expect(labeled).toHaveLength(1);
    expect(labeled[0].label).toBeTruthy();
  });

  it("clears session and UI state for /clear", async () => {
    const app = createAppStub();
    const session = new Session(`test-clear-${Date.now()}`);
    session.addMessage("user", "hello");

    let optimizerReset = false;
    const result = await handleSlashCommand({
      text: "/clear",
      app,
      session,
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset: () => { optimizerReset = true; } }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(session.getMessages()).toHaveLength(0);
    expect(app.cleared).toBe(true);
    expect(app.costReset).toBe(true);
    expect(optimizerReset).toBe(true);
  });

  it("routes template slash commands back into the normal send path", async () => {
    mkdirSync(localTemplateDir, { recursive: true });
    writeFileSync(templatePath, "Template body\n\n{{file}}", "utf-8");

    const app = createAppStub();
    app.getFileContexts = () => new Map([["src/app.ts", "const x = 1;"]]);
    const session = new Session(`test-template-${Date.now()}`);

    const result = await handleSlashCommand({
      text: "/slash-test-template extra context",
      app,
      session,
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(false);
    expect(result.templateLoaded).toBe(true);
    expect(app.messages[0]).toEqual({ role: "user", content: "/slash-test-template extra context" });
    expect(session.getMessages()).toHaveLength(1);
    expect(session.getMessages()[0].content).toContain("Template body");
    expect(session.getMessages()[0].content).toContain("--- @src/app.ts ---");
    expect(session.getMessages()[0].content).toContain("extra context");
  });

  it("replaces the active session for /fork", async () => {
    const app = createAppStub();
    const session = new Session(`test-fork-${Date.now()}`);
    session.addMessage("user", "hello");

    let replaced: Session | null = null;
    const result = await handleSlashCommand({
      text: "/fork",
      app,
      session,
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: (next) => {
        replaced = next;
      },
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(replaced).not.toBeNull();
    expect(replaced?.getId()).not.toBe(session.getId());
    expect(replaced?.getMessages().map((msg) => msg.content)).toEqual(["hello"]);
  });

  it("keeps duplicate theme and picker controls out of /settings", async () => {
    const app = createAppStub();
    let capturedEntries: Array<{ key: string; label: string }> = [];
    app.openSettings = (entries: Array<{ key: string; label: string }>) => {
      capturedEntries = entries;
    };

    const result = await handleSlashCommand({
      text: "/settings",
      app,
      session: new Session(`test-settings-${Date.now()}`),
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(capturedEntries.some((entry) => entry.key === "theme")).toBe(false);
    expect(capturedEntries.some((entry) => entry.key === "editorModel")).toBe(false);
    expect(capturedEntries.some((entry) => entry.key === "architectMode")).toBe(false);
    expect(capturedEntries.some((entry) => entry.key === "followUpMode")).toBe(false);
  });

  it("routes /login to the oauth login flow", async () => {
    const app = createAppStub();
    let ranLogin: { title: string; command: string; args: string[] } | null = null;
    app.runExternalCommand = (title: string, command: string, args: string[]) => {
      ranLogin = { title, command, args };
      return 0;
    };

    const result = await handleSlashCommand({
      text: "/login codex",
      app,
      session: new Session(`test-login-${Date.now()}`),
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: { getProviderInfo: () => ({ name: "Codex" }) } as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [{ id: "codex" }] as any,
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(ranLogin).toEqual({
      title: "Login to ChatGPT Plus/Pro (Codex Subscription)",
      command: "codex",
      args: ["login"],
    });
  });

  it("routes /connect to the non-oauth connect flow", async () => {
    const app = createAppStub();
    let prompt = "";
    app.showQuestion = async (nextPrompt: string) => {
      prompt = nextPrompt;
      return "sk-test-key";
    };
    const previousOpenAiEnv = process.env.OPENAI_API_KEY;
    const previousProviderConfig = loadConfig().providers?.openai
      ? { ...loadConfig().providers!.openai }
      : undefined;
    delete process.env.OPENAI_API_KEY;
    updateProviderConfig("openai", { apiKey: null, disabled: null }, "global");

    const providerRegistry = {
      getProviderInfo: () => ({ id: "openai", name: "OpenAI" }),
      getConnectStatus: () => "api key",
    } as any;
    try {
      const result = await handleSlashCommand({
        text: "/connect openai",
        app,
        session: new Session(`test-connect-${Date.now()}`),
        activeModel: null,
        currentModelId: "",
        currentMode: "build",
        systemPrompt: "sys",
        providerRegistry,
        buildVisibleModelOptions: () => [],
        refreshProviderState: async () => [],
        isSkippedPromptAnswer: () => false,
        isValidHttpBaseUrl: () => true,
        getContextOptimizer: () => ({ reset() {} }) as any,
        onSessionReplace: () => {},
        onModelChange: () => {},
        onSystemPromptChange: () => {},
        hooks: { emit() {} },
        onProjectChange: () => {},
      });

      expect(result.handled).toBe(true);
      expect(prompt).toBe("Paste OpenAI API key");
    } finally {
      if (previousOpenAiEnv) process.env.OPENAI_API_KEY = previousOpenAiEnv;
      else delete process.env.OPENAI_API_KEY;
      updateProviderConfig("openai", {
        apiKey: previousProviderConfig?.apiKey ?? null,
        baseUrl: previousProviderConfig?.baseUrl ?? null,
        disabled: previousProviderConfig?.disabled ?? null,
      }, "global");
    }
  });

  it("writes a standalone html share for /share", async () => {
    const app = createAppStub();
    const session = new Session(`test-share-${Date.now()}`);
    session.addMessage("user", "share this session");
    session.addMessage("assistant", "done");

    const result = await handleSlashCommand({
      text: "/share",
      app,
      session,
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(app.messages.some((entry) => entry.content.includes("Shared to"))).toBe(true);
  });

  it("does not add transcript comments for /thinking and /caveman toggles", async () => {
    const app = createAppStub();
    const session = new Session(`test-toggle-comments-${Date.now()}`);

    const thinkingResult = await handleSlashCommand({
      text: "/thinking",
      app,
      session,
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    const cavemanResult = await handleSlashCommand({
      text: "/caveman",
      app,
      session,
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(thinkingResult.handled).toBe(true);
    expect(cavemanResult.handled).toBe(true);
    expect(app.messages).toEqual([]);
  });

  it("shows a compact budget report for /budget", async () => {
    const app = createAppStub();
    const session = new Session(`test-budget-${Date.now()}`);
    session.addUsage(120, 45, 0.0012);
    session.recordTurn({ smallModel: true, toolsExposed: 5, toolsUsed: 2, plannerCacheHit: false });
    session.recordIdleCacheCliff();
    session.recordCompaction({ freshThreadCarryForward: true });

    let opened: { title: string; reports: any; scope?: "all" | "session" } | null = null;
    app.openBudgetView = (title: string, reports: any, scope?: "all" | "session") => {
      opened = { title, reports, scope };
    };

    const result = await handleSlashCommand({
      text: "/budget",
      app,
      session,
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(opened?.title).toBe("Budget Inspector");
    expect(opened?.scope).toBe("all");
    expect(opened?.reports.session.totalTokens).toBe(165);
    expect(opened?.reports.session.idleCacheCliffs).toBe(1);
    expect(opened?.reports.session.freshThreadCarryForwards).toBe(1);
    expect(opened?.reports.all.sessionCount).toBeGreaterThanOrEqual(1);
  });

  it("reloads extensions immediately when toggled with enter", async () => {
    mkdirSync(extDir, { recursive: true });
    writeFileSync(extPath, "exports.register = () => {};", "utf-8");

    const app = createAppStub();
    let reloaded = 0;
    let latestItems: Array<{ id: string; label: string; detail?: string }> = [];
    let onSelect: ((id: string) => void) | null = null;
    app.openItemPicker = (_title: string, _items: any[], nextOnSelect: (id: string) => void) => {
      onSelect = nextOnSelect;
    };
    app.updateItemPickerItems = (items: Array<{ id: string; label: string; detail?: string }>) => {
      latestItems = items;
    };

    await handleSlashCommand({
      text: "/extensions",
      app,
      session: new Session(`test-extensions-${Date.now()}`),
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {}, reload() { reloaded += 1; } },
      onProjectChange: () => {},
    });

    onSelect?.("slash-test-extension");

    expect(reloaded).toBe(1);
    expect(latestItems.find((item) => item.id === "slash-test-extension")?.detail).toBe("disabled");
  });

  it("opens an empty extensions picker instead of writing a transcript message", async () => {
    const app = createAppStub();
    let pickerItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      pickerItems = items;
    };

    const result = await handleSlashCommand({
      text: "/extensions",
      app,
      session: new Session(`test-extensions-empty-${Date.now()}`),
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(app.messages).toEqual([]);
    expect(pickerItems).toEqual([{ id: "__none__", label: "None", detail: "~/.brokecli/extensions is empty" }]);
  });

  it("opens templates and skills in pickers instead of dumping text into chat", async () => {
    mkdirSync(localTemplateDir, { recursive: true });
    writeFileSync(templatePath, "Template body", "utf-8");

    const app = createAppStub();
    const opened: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }> }> = [];
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      opened.push({ title, items });
    };

    try {
      const templateResult = await handleSlashCommand({
        text: "/templates",
        app,
        session: new Session(`test-templates-picker-${Date.now()}`),
        activeModel: null,
        currentModelId: "",
        currentMode: "build",
        systemPrompt: "sys",
        providerRegistry: {} as any,
        buildVisibleModelOptions: () => [],
        refreshProviderState: async () => [],
        isSkippedPromptAnswer: () => false,
        isValidHttpBaseUrl: () => true,
        getContextOptimizer: () => ({ reset() {} }) as any,
        onSessionReplace: () => {},
        onModelChange: () => {},
        onSystemPromptChange: () => {},
        hooks: { emit() {} },
        onProjectChange: () => {},
      });

      const skillsResult = await handleSlashCommand({
        text: "/skills",
        app,
        session: new Session(`test-skills-picker-${Date.now()}`),
        activeModel: null,
        currentModelId: "",
        currentMode: "build",
        systemPrompt: "sys",
        providerRegistry: {} as any,
        buildVisibleModelOptions: () => [],
        refreshProviderState: async () => [],
        isSkippedPromptAnswer: () => false,
        isValidHttpBaseUrl: () => true,
        getContextOptimizer: () => ({ reset() {} }) as any,
        onSessionReplace: () => {},
        onModelChange: () => {},
        onSystemPromptChange: () => {},
        hooks: { emit() {} },
        onProjectChange: () => {},
      });

      expect(templateResult.handled).toBe(true);
      expect(skillsResult.handled).toBe(true);
      expect(app.messages).toEqual([]);
      expect(opened.find((entry) => entry.title === "Templates")?.items.some((item) => item.label === "/slash-test-template")).toBe(true);
      expect((opened.find((entry) => entry.title === "Skills")?.items.length ?? 0) > 0).toBe(true);
    } finally {
      if (existsSync(templatePath)) rmSync(templatePath, { force: true });
    }
  });

  it("explains that /resume is unavailable when session persistence is off", async () => {
    updateSetting("autoSaveSessions", false);

    const app = createAppStub();
    let pickerItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      pickerItems = items;
    };
    const session = new Session(`test-resume-disabled-${Date.now()}`);

    try {
      const result = await handleSlashCommand({
        text: "/resume",
        app,
        session,
        activeModel: null,
        currentModelId: "",
        currentMode: "build",
        systemPrompt: "sys",
        providerRegistry: {} as any,
        buildVisibleModelOptions: () => [],
        refreshProviderState: async () => [],
        isSkippedPromptAnswer: () => false,
        isValidHttpBaseUrl: () => true,
        getContextOptimizer: () => ({ reset() {} }) as any,
        onSessionReplace: () => {},
        onModelChange: () => {},
        onSystemPromptChange: () => {},
        hooks: { emit() {} },
        onProjectChange: () => {},
      });

      expect(result.handled).toBe(true);
      expect(app.messages).toEqual([]);
      expect(pickerItems).toEqual([{ id: "__none__", label: "None", detail: "session history is off" }]);
    } finally {
      updateSetting("autoSaveSessions", true);
    }
  });

  it("keeps /resume scoped to the current project", async () => {
    updateSetting("autoSaveSessions", true);
    const app = createAppStub();
    let capturedItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      capturedItems = items;
    };

    const local = new Session(`test-resume-local-${Date.now()}`);
    local.addMessage("user", "local session");
    const remote = new Session(`test-resume-remote-${Date.now()}`);
    (remote as any).cwd = "C:\\other-project";
    remote.addMessage("user", "remote session");

    const result = await handleSlashCommand({
      text: "/resume",
      app,
      session: new Session(`test-resume-query-${Date.now()}`),
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(capturedItems.some((item) => item.label.includes("local session"))).toBe(true);
    expect(capturedItems.some((item) => item.label.includes("remote session"))).toBe(false);
  });

  it("opens the agent task inspector for /agents", async () => {
    const app = createAppStub();
    let opened: { title: string; runs: any[] } | null = null;
    app.getAgentRuns = () => [{
      id: "run-1",
      prompt: "Review the failing tests",
      status: "done",
      result: "Tests fail in session-manager",
      detail: "model openai/gpt-5.4 · tools readFile,grep",
      createdAt: Date.now(),
    }];
    app.openAgentRunsView = (title: string, runs: any[]) => {
      opened = { title, runs };
    };

    const result = await handleSlashCommand({
      text: "/agents",
      app,
      session: new Session(`test-agents-${Date.now()}`),
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(opened?.title).toBe("Agent Tasks");
    expect(opened?.runs).toHaveLength(1);
  });

  it("opens an empty agent task inspector for /agents with no runs", async () => {
    const app = createAppStub();
    let opened: { title: string; runs: any[] } | null = null;
    app.openAgentRunsView = (title: string, runs: any[]) => {
      opened = { title, runs };
    };

    const result = await handleSlashCommand({
      text: "/agents",
      app,
      session: new Session(`test-agents-empty-${Date.now()}`),
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(opened?.title).toBe("Agent Tasks");
    expect(opened?.runs).toEqual([]);
    expect(app.messages).toEqual([]);
  });

  it("opens a session info picker for /session", async () => {
    const app = createAppStub();
    let sessionItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      sessionItems = items;
    };
    const session = new Session(`test-session-info-${Date.now()}`);
    session.setName("Test Session");
    session.addMessage("user", "hello");

    const result = await handleSlashCommand({
      text: "/session",
      app,
      session,
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(sessionItems.some((item) => item.label === "Test Session")).toBe(true);
    expect(sessionItems.some((item) => item.detail === "session dir")).toBe(true);
  });

  it("opens a hotkeys picker for /hotkeys", async () => {
    const app = createAppStub();
    let hotkeyItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      hotkeyItems = items;
    };

    const result = await handleSlashCommand({
      text: "/hotkeys",
      app,
      session: new Session(`test-hotkeys-${Date.now()}`),
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => [],
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {} },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(hotkeyItems.some((item) => item.detail === "send")).toBe(true);
    expect(hotkeyItems.some((item) => item.detail === "newline")).toBe(true);
  });

  it("reloads extensions and provider state for /reload", async () => {
    const app = createAppStub();
    let reloaded = 0;
    let refreshed = 0;
    const result = await handleSlashCommand({
      text: "/reload",
      app,
      session: new Session(`test-reload-${Date.now()}`),
      activeModel: null,
      currentModelId: "",
      currentMode: "build",
      systemPrompt: "sys",
      providerRegistry: {} as any,
      buildVisibleModelOptions: () => [],
      refreshProviderState: async () => {
        refreshed += 1;
        return [];
      },
      isSkippedPromptAnswer: () => false,
      isValidHttpBaseUrl: () => true,
      getContextOptimizer: () => ({ reset() {} }) as any,
      onSessionReplace: () => {},
      onModelChange: () => {},
      onSystemPromptChange: () => {},
      hooks: { emit() {}, reload() { reloaded += 1; } },
      onProjectChange: () => {},
    });

    expect(result.handled).toBe(true);
    expect(reloaded).toBe(1);
    expect(refreshed).toBe(1);
  });

  it("clears stored auth for /logout <provider>", async () => {
    const previousConfig = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
    const previousAuth = existsSync(authPath) ? readFileSync(authPath, "utf-8") : null;

    try {
      updateProviderConfig("openai", { apiKey: "sk-test-config-key" });
      saveCredentials("openai", "test-auth-token");

      const app = createAppStub();
      const session = new Session(`test-logout-${Date.now()}`);

      const result = await handleSlashCommand({
        text: "/logout openai",
        app,
        session,
        activeModel: null,
        currentModelId: "",
        currentMode: "build",
        systemPrompt: "sys",
        providerRegistry: {} as any,
        buildVisibleModelOptions: () => [],
        refreshProviderState: async () => [],
        isSkippedPromptAnswer: () => false,
        isValidHttpBaseUrl: () => true,
        getContextOptimizer: () => ({ reset() {} }) as any,
        onSessionReplace: () => {},
        onModelChange: () => {},
        onSystemPromptChange: () => {},
        hooks: { emit() {} },
        onProjectChange: () => {},
      });

      expect(result.handled).toBe(true);
      expect(getCredentials("openai")).toBeNull();
      expect(loadConfig().providers?.openai?.apiKey).toBeUndefined();
      expect(app.messages.some((entry) => entry.content.includes("Cleared stored brokecli auth for: openai"))).toBe(true);
    } finally {
      if (previousConfig == null) {
        if (existsSync(configPath)) unlinkSync(configPath);
      } else {
        writeFileSync(configPath, previousConfig, "utf-8");
      }
      if (previousAuth == null) {
        if (existsSync(authPath)) unlinkSync(authPath);
      } else {
        writeFileSync(authPath, previousAuth, "utf-8");
      }
    }
  });
});
