import { afterEach, describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { loadConfig, updateModelPreference, updateProviderConfig, updateSetting } from "../src/core/config.js";
import {
  cleanupSlashCommandFixtures,
  coreTemplatePath,
  createAppStub,
  createSlashArgs,
  localTemplateDir,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "./slash-command-test-helpers.js";

afterEach(() => {
  cleanupSlashCommandFixtures();
  rmSync(coreTemplatePath, { force: true });
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
      ...createSlashArgs({
        getContextOptimizer: () => ({ reset: () => { optimizerReset = true; } }) as any,
      }),
    });

    expect(result.handled).toBe(true);
    expect(session.getMessages()).toHaveLength(0);
    expect(app.cleared).toBe(true);
    expect(app.costReset).toBe(true);
    expect(optimizerReset).toBe(true);
  });

  it("routes template slash commands back into the normal send path", async () => {
    mkdirSync(localTemplateDir, { recursive: true });
    writeFileSync(coreTemplatePath, "Template body\n\n{{file}}", "utf-8");

    const app = createAppStub();
    app.getFileContexts = () => new Map([["src/app.ts", "const x = 1;"]]);
    const session = new Session(`test-template-${Date.now()}`);

    const result = await handleSlashCommand({
      text: "/slash-test-template-core extra context",
      app,
      session,
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(false);
    expect(result.templateLoaded).toBe(true);
    expect(app.messages[0]).toEqual({ role: "user", content: "/slash-test-template-core extra context" });
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
      ...createSlashArgs({
        onSessionReplace: (next: Session) => {
          replaced = next;
        },
      }),
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
      ...createSlashArgs(),
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
      ...createSlashArgs({
        providerRegistry: { getProviderInfo: () => ({ name: "Codex" }) } as any,
        refreshProviderState: async () => [{ id: "codex" }] as any,
      }),
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
        ...createSlashArgs({ providerRegistry }),
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

  it("does not add transcript comments for /thinking and /caveman toggles", async () => {
    const app = createAppStub();
    const session = new Session(`test-toggle-comments-${Date.now()}`);

    const thinkingResult = await handleSlashCommand({
      text: "/thinking",
      app,
      session,
      ...createSlashArgs(),
    });

    const cavemanResult = await handleSlashCommand({
      text: "/caveman",
      app,
      session,
      ...createSlashArgs(),
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
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    expect(opened?.title).toBe("Budget Inspector");
    expect(opened?.scope).toBe("all");
    expect(opened?.reports.session.totalTokens).toBe(165);
    expect(opened?.reports.session.idleCacheCliffs).toBe(1);
    expect(opened?.reports.session.freshThreadCarryForwards).toBe(1);
    expect(opened?.reports.all.sessionCount).toBeGreaterThanOrEqual(1);
  });

  it("offers only sidebar-listed models in /switch and switches to the selected one", async () => {
    const app = createAppStub();
    let pickerTitle = "";
    let pickerItems: Array<{ id: string; label: string; detail?: string }> = [];
    let switched: { providerName: string; modelId: string } | null = null;
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>, onSelect: (id: string) => void) => {
      pickerTitle = title;
      pickerItems = items;
      onSelect("anthropic/claude-sonnet-4.6-fast");
    };
    app.setModel = (providerName: string, modelId: string) => {
      switched = { providerName, modelId };
    };

    const previousSmall = loadConfig().settings?.modelPreferences?.small ?? null;
    try {
      updateModelPreference("small", "anthropic/claude-sonnet-4.6-fast");
      const session = new Session(`test-switch-${Date.now()}`);
      const result = await handleSlashCommand({
        text: "/switch",
        app,
        session,
        ...createSlashArgs({
          activeModel: { provider: { id: "anthropic", name: "Anthropic" } },
          currentModelId: "claude-sonnet-4.6",
          providerRegistry: {
            createModel: (providerId: string, modelId: string) => ({
              provider: { id: providerId, name: providerId === "anthropic" ? "Anthropic" : providerId },
              runtime: "sdk",
              model: {},
            }),
          } as any,
        }),
      });

      expect(result.handled).toBe(true);
      expect(pickerTitle).toBe("Switch model");
      expect(pickerItems.some((item) => item.id === "anthropic/claude-sonnet-4.6")).toBe(true);
      expect(pickerItems.some((item) => item.id === "anthropic/claude-sonnet-4.6-fast")).toBe(true);
      expect(pickerItems.some((item) => item.detail?.includes("Chat"))).toBe(true);
      expect(pickerItems.some((item) => item.detail?.includes("Fast"))).toBe(true);
      expect(switched).toEqual({ providerName: "Anthropic", modelId: "claude-sonnet-4.6-fast" });
    } finally {
      updateModelPreference("small", previousSmall);
    }
  });
});
