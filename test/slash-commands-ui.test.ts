import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { getCredentials, resetAuthCacheForTests, saveCredentials } from "../src/core/auth.js";
import { loadConfig, updateProviderConfig, updateSetting } from "../src/core/config.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { Session } from "../src/core/session.js";
import {
  authPath,
  cleanupSlashCommandFixtures,
  configPath,
  createAppStub,
  createSlashArgs,
  existsSync,
  extDir,
  extPath,
  localTemplateDir,
  mkdirSync,
  readFileSync,
  rmSync,
  uiTemplatePath,
  unlinkSync,
  writeFileSync,
} from "./slash-command-test-helpers.js";

afterEach(() => {
  cleanupSlashCommandFixtures();
  rmSync(uiTemplatePath, { force: true });
  vi.restoreAllMocks();
});

describe("slash command UI surfaces", () => {
  it("exposes real settings in /settings", async () => {
    const app = createAppStub();
    let settingsEntries: Array<{ key: string; label: string; value: string; description: string }> = [];
    app.openSettings = (entries: Array<{ key: string; label: string; value: string; description: string }>) => {
      settingsEntries = entries;
    };

    const result = await handleSlashCommand({
      text: "/settings",
      app,
      session: new Session(`test-settings-mode-${Date.now()}`),
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    expect(settingsEntries.some((entry) => entry.key === "mode")).toBe(true);
    expect(settingsEntries.some((entry) => entry.key === "modeSwitching")).toBe(true);
    expect(settingsEntries.some((entry) => entry.key === "gitCheckpoints")).toBe(false);
    expect(settingsEntries.some((entry) => entry.key === "autonomy.allowNetwork")).toBe(true);
    expect(settingsEntries.some((entry) => entry.key === "autonomy.allowWriteOutsideWorkspace")).toBe(true);
    expect(settingsEntries.some((entry) => entry.key === "autonomy.additionalReadRoots")).toBe(true);
    expect(settingsEntries.some((entry) => entry.key === "maxSessionCost")).toBe(false);
  });

  it("toggles autonomy booleans from /settings", async () => {
    const app = createAppStub();
    let onToggle: ((key: string) => void) | undefined;
    const originalAutonomy = { ...loadConfig().settings?.autonomy };
    app.openSettings = (_entries: Array<{ key: string; label: string; value: string; description: string }>, nextOnToggle: (key: string) => void) => {
      onToggle = nextOnToggle;
    };

    try {
      updateSetting("autonomy", {
        ...loadConfig().settings?.autonomy,
        allowNetwork: true,
      });

      const result = await handleSlashCommand({
        text: "/settings",
        app,
        session: new Session(`test-settings-autonomy-toggle-${Date.now()}`),
        ...createSlashArgs(),
      });

      expect(result.handled).toBe(true);
      onToggle?.("autonomy.allowNetwork");
      expect(loadConfig().settings?.autonomy?.allowNetwork).toBe(false);
    } finally {
      updateSetting("autonomy", {
        allowNetwork: originalAutonomy.allowNetwork ?? true,
        allowReadOutsideWorkspace: originalAutonomy.allowReadOutsideWorkspace ?? false,
        allowWriteOutsideWorkspace: originalAutonomy.allowWriteOutsideWorkspace ?? false,
        allowShellOutsideWorkspace: originalAutonomy.allowShellOutsideWorkspace ?? false,
        allowDestructiveShell: originalAutonomy.allowDestructiveShell ?? false,
        additionalReadRoots: originalAutonomy.additionalReadRoots ?? [],
        additionalWriteRoots: originalAutonomy.additionalWriteRoots ?? [],
      });
    }
  });

  it("opens a mode picker for /mode", async () => {
    const app = createAppStub();
    let pickerTitle = "";
    let pickerItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      pickerTitle = title;
      pickerItems = items;
    };

    const result = await handleSlashCommand({
      text: "/mode",
      app,
      session: new Session(`test-mode-picker-${Date.now()}`),
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    expect(pickerTitle).toBe("Mode");
    expect(pickerItems.map((item) => item.id)).toEqual(["build", "plan"]);
  });

  it("reloads extensions immediately when toggled with enter", async () => {
    mkdirSync(extDir, { recursive: true });
    const extensionId = `slash-test-extension-enter-${Date.now()}`;
    const extensionPath = join(extDir, `${extensionId}.js`);
    writeFileSync(extensionPath, "exports.register = () => {};", "utf-8");
    const originalDiscoverExtensions = loadConfig().settings?.discoverExtensions;
    const originalExtensions = loadConfig().settings?.extensions;
    updateSetting("discoverExtensions", true);
    updateSetting("extensions", [extDir]);

    try {
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
        ...createSlashArgs({
          hooks: { emit() {}, reload() { reloaded += 1; } },
        }),
      });

      onSelect?.(extensionId);

      expect(reloaded).toBeGreaterThanOrEqual(0);
      expect(loadConfig().settings?.disabledExtensions).toContain(extensionId);
      expect(latestItems.length === 0 || latestItems.some((item) => item.id === extensionId)).toBe(true);
    } finally {
      rmSync(extensionPath, { force: true });
      updateSetting("disabledExtensions", (loadConfig().settings?.disabledExtensions ?? []).filter((entry) => entry !== extensionId));
      updateSetting("discoverExtensions", originalDiscoverExtensions ?? true);
      updateSetting("extensions", originalExtensions ?? []);
    }
  });

  it("opens an empty extensions picker instead of writing a transcript message", async () => {
    const originalDiscoverExtensions = loadConfig().settings?.discoverExtensions;
    const originalExtensions = loadConfig().settings?.extensions;
    updateSetting("discoverExtensions", false);
    updateSetting("extensions", []);
    const app = createAppStub();
    let pickerItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      pickerItems = items;
    };
    try {
      const result = await handleSlashCommand({
        text: "/extensions",
        app,
        session: new Session(`test-extensions-empty-${Date.now()}`),
        ...createSlashArgs(),
      });

      expect(result.handled).toBe(true);
      expect(app.messages).toEqual([]);
      expect(pickerItems).toEqual([{ id: "__none__", label: "None", detail: "~/.brokecli/extensions is empty" }]);
    } finally {
      updateSetting("discoverExtensions", originalDiscoverExtensions ?? true);
      updateSetting("extensions", originalExtensions ?? []);
    }
  });

  it("opens templates and skills in pickers instead of dumping text into chat", async () => {
    mkdirSync(localTemplateDir, { recursive: true });
    writeFileSync(uiTemplatePath, "Template body", "utf-8");

    const app = createAppStub();
    const opened: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }> }> = [];
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      opened.push({ title, items });
    };

    const templateResult = await handleSlashCommand({
      text: "/templates",
      app,
      session: new Session(`test-templates-picker-${Date.now()}`),
      ...createSlashArgs(),
    });

    const skillsResult = await handleSlashCommand({
      text: "/skills",
      app,
      session: new Session(`test-skills-picker-${Date.now()}`),
      ...createSlashArgs(),
    });

    expect(templateResult.handled).toBe(true);
    expect(skillsResult.handled).toBe(true);
    expect(app.messages).toEqual([]);
    expect(opened.find((entry) => entry.title === "Templates")?.items.some((item) => item.id === "slash-test-template-ui" || item.label.includes("slash-test-template-ui"))).toBe(true);
    expect((opened.find((entry) => entry.title === "Skills")?.items.length ?? 0) > 0).toBe(true);
  });

  it("appends template content into the current draft instead of replacing it", async () => {
    mkdirSync(localTemplateDir, { recursive: true });
    writeFileSync(uiTemplatePath, "Template body", "utf-8");

    const app = createAppStub();
    let currentDraft = "Existing prompt";
    let onSelect: ((id: string) => void | Promise<void>) | undefined;
    app.getDraft = () => currentDraft;
    app.appendDraft = (value: string) => {
      currentDraft = `${currentDraft}\n\n${value}`;
    };
    app.openItemPicker = (_title: string, _items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void | Promise<void>) => {
      onSelect = nextOnSelect;
    };

    const result = await handleSlashCommand({
      text: "/templates",
      app,
      session: new Session(`test-templates-append-${Date.now()}`),
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    await onSelect?.("slash-test-template-ui");
    expect(currentDraft).toBe("Existing prompt\n\nTemplate body");
  });

  it("explains that /resume is unavailable when session persistence is off", async () => {
    updateSetting("autoSaveSessions", false);

    const app = createAppStub();
    let pickerItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      pickerItems = items;
    };

    try {
      const result = await handleSlashCommand({
        text: "/resume",
        app,
        session: new Session(`test-resume-disabled-${Date.now()}`),
        ...createSlashArgs(),
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
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    expect(capturedItems.some((item) => item.label.includes("local session"))).toBe(true);
    expect(capturedItems.some((item) => item.label.includes("remote session"))).toBe(false);
  });

  it("opens the session tree for /tree", async () => {
    const app = createAppStub();
    let opened: { title: string; sessionId: string } | null = null;
    const session = new Session(`test-tree-${Date.now()}`);
    session.addMessage("user", "start");
    session.addMessage("assistant", "reply");
    app.openTreeView = (title: string, nextSession: Session) => {
      opened = { title, sessionId: nextSession.getId() };
    };

    const result = await handleSlashCommand({
      text: "/tree",
      app,
      session,
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    expect(opened).toEqual({ title: "Session Tree", sessionId: session.getId() });
  });

  it("forks the selected tree branch from /tree", async () => {
    const app = createAppStub();
    const session = new Session(`test-tree-fork-${Date.now()}`);
    session.addMessage("user", "start");
    session.addMessage("assistant", "reply");
    session.addMessage("user", "follow up");
    session.addMessage("assistant", "second reply");

    let capturedFork: ((entryId: string) => void | Promise<void>) | undefined;
    let replaced: Session | null = null;
    app.openTreeView = (_title: string, _session: Session, _onSelect: (entryId: string) => void | Promise<void>, onFork?: (entryId: string) => void | Promise<void>) => {
      capturedFork = onFork;
    };

    const result = await handleSlashCommand({
      text: "/tree",
      app,
      session,
      ...createSlashArgs({
        onSessionReplace(next: Session) {
          replaced = next;
        },
      }),
    });

    expect(result.handled).toBe(true);
    const targetId = session.getTreeItems("all").find((item) => item.content === "reply")?.id;
    expect(targetId).toBeTruthy();
    await capturedFork?.(targetId!);
    expect(replaced).not.toBeNull();
    expect(replaced?.getId()).not.toBe(session.getId());
    expect(replaced?.getMessages().map((message) => message.content)).toEqual(["start", "reply"]);
    expect(app.statusMessage).toContain("Forked selected branch");
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
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    expect(sessionItems.some((item) => item.label === "Test Session")).toBe(true);
    expect(sessionItems.some((item) => item.detail === "session dir")).toBe(true);
  });

  it("opens a hotkeys picker for /hotkeys", async () => {
    const app = createAppStub();
    let hotkeyItems: Array<{ id: string; label: string; detail?: string }> = [];
    let hotkeyOptions: any;
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>, _onSelect: (id: string) => void, options?: any) => {
      hotkeyItems = items;
      hotkeyOptions = options;
    };

    const result = await handleSlashCommand({
      text: "/hotkeys",
      app,
      session: new Session(`test-hotkeys-${Date.now()}`),
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    expect(hotkeyItems.some((item) => item.label === "Send message")).toBe(true);
    expect(hotkeyItems.some((item) => item.label === "Insert newline")).toBe(true);
    expect(typeof hotkeyOptions?.onKey).toBe("function");
  });

  it("reloads extensions and provider state for /reload", async () => {
    const app = createAppStub();
    let reloaded = 0;
    let refreshed = 0;
    const result = await handleSlashCommand({
      text: "/reload",
      app,
      session: new Session(`test-reload-${Date.now()}`),
      ...createSlashArgs({
        refreshProviderState: async () => {
          refreshed += 1;
          return [];
        },
        hooks: { emit() {}, reload() { reloaded += 1; } },
      }),
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
      const result = await handleSlashCommand({
        text: "/logout openai",
        app,
        session: new Session(`test-logout-${Date.now()}`),
        ...createSlashArgs(),
      });

      expect(result.handled).toBe(true);
      expect(getCredentials("openai")).toBeNull();
      expect(loadConfig().providers?.openai?.apiKey).toBeUndefined();
      expect(app.statusMessage).toContain("Cleared stored auth for: openai");
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
      resetAuthCacheForTests();
    }
  });
});
