import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, updateSetting } from "../src/core/config.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { Session } from "../src/core/session.js";
import * as packageManager from "../src/core/package-manager.js";
import * as packageSearch from "../src/core/package-search.js";
import { cleanupSlashCommandFixtures, createAppStub, createSlashArgs } from "./slash-command-test-helpers.js";

afterEach(() => {
  cleanupSlashCommandFixtures();
  vi.restoreAllMocks();
});

describe("package UI surfaces", () => {
  it("opens a package picker for /packages", async () => {
    const previousPackages = loadConfig().settings?.packages ?? [];
    updateSetting("packages", ["npm:@demo/pkg"]);
    const app = createAppStub();
    let packageItems: Array<{ id: string; label: string; detail?: string }> = [];
    app.openItemPicker = (_title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
      packageItems = items;
    };

    try {
      const result = await handleSlashCommand({
        text: "/packages",
        app,
        session: new Session(`test-packages-${Date.now()}`),
        ...createSlashArgs(),
      });

      expect(result.handled).toBe(true);
      expect(packageItems).toHaveLength(1);
      expect(packageItems[0]).toMatchObject({ label: "npm:@demo/pkg" });
      expect(packageItems[0]?.detail).toContain("missing");
    } finally {
      updateSetting("packages", previousPackages);
    }
  });

  it("searches and installs packages from /packages <query>", async () => {
    const app = createAppStub();
    const opened: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }>; onSelect: (id: string) => void }> = [];
    vi.spyOn(packageManager, "installPackage").mockResolvedValue();
    let reloaded = 0;
    vi.spyOn(packageSearch, "searchPackageRegistry").mockResolvedValue([
      {
        source: "npm:@demo/skill-pack",
        name: "@demo/skill-pack",
        version: "1.2.3",
        description: "demo package",
        resources: { extensions: 1, skills: 2, prompts: 0, themes: 0 },
      },
    ]);
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      opened.push({ title, items, onSelect: nextOnSelect });
    };

    const result = await handleSlashCommand({
      text: "/packages demo",
      app,
      session: new Session(`test-packages-search-${Date.now()}`),
      ...createSlashArgs({
        hooks: { emit() {}, reload() { reloaded += 1; } },
      }),
    });

    expect(result.handled).toBe(true);
    expect(opened[0]?.items[0]).toMatchObject({
      id: "npm:@demo/skill-pack",
      label: "@demo/skill-pack",
    });
    opened[0]?.onSelect("npm:@demo/skill-pack");
    expect(opened[1]?.title).toBe("Install package");
    opened[1]?.onSelect("project");
    await Promise.resolve();
    expect(packageManager.installPackage).toHaveBeenCalledWith("npm:@demo/skill-pack", { local: true });
    expect(reloaded).toBe(1);
    expect(app.statusMessage).toContain("Installed npm:@demo/skill-pack in project scope");
  });

  it("offers package actions for installed packages", async () => {
    const previousPackages = loadConfig().settings?.packages ?? [];
    updateSetting("packages", ["npm:@demo/pkg"]);
    const app = createAppStub();
    const opened: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }>; onSelect: (id: string) => void }> = [];
    vi.spyOn(packageManager, "removePackage").mockResolvedValue();
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      opened.push({ title, items, onSelect: nextOnSelect });
    };

    try {
      const result = await handleSlashCommand({
        text: "/packages",
        app,
        session: new Session(`test-packages-actions-${Date.now()}`),
        ...createSlashArgs(),
      });

      expect(result.handled).toBe(true);
      opened[0]?.onSelect("global:npm:@demo/pkg");
      expect(opened[1]?.title).toContain("Package:");
      expect(opened[1]?.items.some((item) => item.id === "remove")).toBe(true);
      opened[1]?.onSelect("remove");
      expect(packageManager.removePackage).toHaveBeenCalledWith("npm:@demo/pkg", { local: false });
    } finally {
      updateSetting("packages", previousPackages);
    }
  });
});
