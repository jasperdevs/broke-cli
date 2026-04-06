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

  it("explains that /resume is unavailable when session persistence is off", async () => {
    updateSetting("autoSaveSessions", false);

    const app = createAppStub();
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
      expect(app.messages.some((entry) => entry.content.includes("Session history is off"))).toBe(true);
    } finally {
      updateSetting("autoSaveSessions", true);
    }
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
