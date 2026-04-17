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
  it("shows supported SDK provider diagnostics in a picker", async () => {
    const app = createAppStub();
    const opened: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }>; onSelect: (id: string) => void }> = [];
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      opened.push({ title, items, onSelect: nextOnSelect });
    };
    vi.spyOn(detect, "inspectProviders").mockResolvedValue([
      { id: "openai", name: "OpenAI", available: false, reason: "set OPENAI_API_KEY" },
      { id: "anthropic", name: "Anthropic", available: true, reason: "configured auth (env)" },
    ]);
    const providerRegistry = {
      getProviderInfo: (id: string) => ({ id, name: id === "openai" ? "OpenAI" : "Anthropic" }),
    } as any;

    const result = await handleSlashCommand({
      text: "/providers",
      app,
      session: new Session(`test-providers-${Date.now()}`),
      ...createSlashArgs({
        providerRegistry,
        refreshProviderState: async () => [{ id: "anthropic", name: "Anthropic", available: true, reason: "configured auth (env)" }] as any,
      }),
    });

    expect(result.handled).toBe(true);
    expect(opened[0]?.title).toBe("Providers");
    expect(opened[0]?.items.map((item) => item.label)).toEqual(["OpenAI", "Anthropic"]);
    await opened[0]?.onSelect("openai");
    expect(app.statusMessage).toContain("OPENAI_API_KEY");
  });
});
