import { afterEach, describe, expect, it, vi } from "vitest";
import { Session } from "../src/core/session.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { getSettings, loadConfig, updateProviderConfig, updateSetting } from "../src/core/config.js";
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

vi.mock("../src/ai/native-cli.js", () => ({
  resolveNativeCommand: vi.fn((command: string) => command),
}));

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

  it("updates the auto-compact threshold for /compact-at", async () => {
    const previous = loadConfig().settings?.compaction?.triggerPercent ?? 80;
    const app = createAppStub();

    try {
      const result = await handleSlashCommand({
        text: "/compact-at 70",
        app,
        session: new Session(`test-compact-at-${Date.now()}`),
        ...createSlashArgs(),
      });

      expect(result.handled).toBe(true);
      expect(loadConfig().settings?.compaction?.triggerPercent).toBe(70);
      expect(app.statusMessage).toBe("Auto-compact threshold set to 70%");
    } finally {
      updateSetting("compaction", {
        ...loadConfig().settings?.compaction,
        triggerPercent: previous,
      });
    }
  });

  it("updates the configured theme for /theme", async () => {
    const app = createAppStub();
    const previousTheme = loadConfig().settings?.theme ?? "brokecli";

    try {
      const result = await handleSlashCommand({
        text: "/theme github-dark",
        app,
        session: new Session(`test-theme-${Date.now()}`),
        ...createSlashArgs(),
      });

      expect(result.handled).toBe(true);
      expect(app.statusMessage).toBe("Theme: GitHub Dark");
    } finally {
      updateSetting("theme", previousTheme);
    }
  });

  it("stages /btw when invoked without a question", async () => {
    const app = createAppStub();
    let draft = "";
    app.setDraft = (value: string) => {
      draft = value;
    };

    const result = await handleSlashCommand({
      text: "/btw",
      app,
      session: new Session(`test-btw-draft-${Date.now()}`),
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    expect(draft).toBe("/btw ");
    expect(app.statusMessage).toBe("Ask a side question after /btw.");
  });

  it("routes /btw to the side-question handler", async () => {
    const app = createAppStub();
    let asked = "";

    const result = await handleSlashCommand({
      text: "/btw does this touch the tests?",
      app,
      session: new Session(`test-btw-run-${Date.now()}`),
      ...createSlashArgs({
        onBtw: async (question: string) => {
          asked = question;
        },
      }),
    });

    expect(result.handled).toBe(true);
    expect(asked).toBe("does this touch the tests?");
    expect(app.statusMessage).toBe("Asking side question...");
  });

  it("does not block the slash handler while /btw is running", async () => {
    const app = createAppStub();
    let release!: () => void;
    let asked = "";
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const resultPromise = handleSlashCommand({
      text: "/btw still running?",
      app,
      session: new Session(`test-btw-nonblocking-${Date.now()}`),
      ...createSlashArgs({
        onBtw: async (question: string) => {
          asked = question;
          await pending;
        },
      }),
    });

    await expect(resultPromise).resolves.toEqual({ handled: true });
    expect(asked).toBe("still running?");
    expect(app.statusMessage).toBe("Asking side question...");
    release();
    await pending;
  });

  it("opens /model with the typed query prefilled", async () => {
    const app = createAppStub();
    let pickerQuery = "";
    let pickerCursor = -1;
    app.openModelPicker = (_options: any[], _onSelect: any, _onPin: any, _onAssign: any, initialCursor?: number, _initialScope?: "all" | "scoped", initialQuery?: string) => {
      pickerCursor = initialCursor ?? -1;
      pickerQuery = initialQuery ?? "";
    };

    const result = await handleSlashCommand({
      text: "/model haiku",
      app,
      session: new Session(`test-model-query-${Date.now()}`),
      ...createSlashArgs({
        buildVisibleModelOptions: () => [
          { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", active: true },
          { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", active: false },
        ] as any,
      }),
    });

    expect(result.handled).toBe(true);
    expect(pickerQuery).toBe("haiku");
    expect(pickerCursor).toBe(2);
    expect(app.statusMessage).toBe('Showing 1 match for "haiku".');
  });

  it("lets the model picker enable auto routing from the synthetic auto entry", async () => {
    updateSetting("autoRoute", false);
    const app = createAppStub();
    let pickerSelect: ((providerId: string, modelId: string) => void) | null = null;
    let pickerOptions: any[] = [];
    app.openModelPicker = (_options: any[], onSelect: any) => {
      pickerOptions = _options;
      pickerSelect = onSelect;
    };

    try {
      const result = await handleSlashCommand({
        text: "/model",
        app,
        session: new Session(`test-model-auto-${Date.now()}`),
        ...createSlashArgs({
          buildVisibleModelOptions: () => [
            { providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", displayName: "GPT-5.4 mini", active: true },
          ] as any,
        }),
      });

      expect(result.handled).toBe(true);
      expect(pickerSelect).toBeTruthy();
      expect(pickerOptions[0]).toMatchObject({ providerId: "__auto__", modelId: "__auto__", displayName: "Auto" });
      pickerSelect?.("__auto__", "__auto__");
      expect(getSettings().autoRoute).toBe(true);
      expect(app.statusMessage).toBe("Auto routing enabled.");
    } finally {
      updateSetting("autoRoute", true);
    }
  });

  it("keeps declarative aliases working for /sessions", async () => {
    updateSetting("autoSaveSessions", false);
    const app = createAppStub();
    let pickerItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      pickerItems = items;
    };

    try {
      const result = await handleSlashCommand({
        text: "/sessions",
        app,
        session: new Session(`test-sessions-alias-${Date.now()}`),
        ...createSlashArgs(),
      });

      expect(result.handled).toBe(true);
      expect(pickerItems).toEqual([{ id: "__none__", label: "None", detail: "session history is off" }]);
    } finally {
      updateSetting("autoSaveSessions", true);
    }
  });
});
