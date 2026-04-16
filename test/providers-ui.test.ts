import { afterEach, describe, expect, it, vi } from "vitest";
import * as detect from "../src/ai/detect.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { Session } from "../src/core/session.js";
import { cleanupSlashCommandFixtures, createAppStub, createSlashArgs } from "./slash-command-test-helpers.js";

afterEach(() => {
  cleanupSlashCommandFixtures();
  vi.restoreAllMocks();
});

describe("provider diagnostics UI", () => {
  it("shows provider diagnostics in a picker and starts OAuth login for OAuth providers", async () => {
    const app = createAppStub();
    const opened: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }>; onSelect: (id: string) => void }> = [];
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      opened.push({ title, items, onSelect: nextOnSelect });
    };
    vi.spyOn(detect, "inspectProviders").mockResolvedValue([
      { id: "codex", name: "Codex", available: false, reason: "run /login codex" },
      { id: "github-copilot", name: "GitHub Copilot", available: true, reason: "OAuth login" },
    ]);
    const providerRegistry = {
      getProviderInfo: (id: string) => ({ id, name: id === "codex" ? "Codex" : "GitHub Copilot" }),
    } as any;

    const result = await handleSlashCommand({
      text: "/providers",
      app,
      session: new Session(`test-providers-${Date.now()}`),
      ...createSlashArgs({
        providerRegistry,
        refreshProviderState: async () => [{ id: "codex", name: "Codex", available: true, reason: "native login" }] as any,
      }),
    });

    expect(result.handled).toBe(true);
    expect(opened[0]?.title).toBe("Providers");
    expect(opened[0]?.items.map((item) => item.label)).toEqual(["Codex", "GitHub Copilot"]);
    await opened[0]?.onSelect("codex");
    expect(app.statusMessage).toContain("Codex");
  });
});
