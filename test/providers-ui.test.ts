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
  it("shows provider diagnostics in a picker and drafts the next fix command", async () => {
    const app = createAppStub();
    let drafted = "";
    app.setDraft = (value: string) => {
      drafted = value;
    };
    const opened: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }>; onSelect: (id: string) => void }> = [];
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      opened.push({ title, items, onSelect: nextOnSelect });
    };
    vi.spyOn(detect, "inspectProviders").mockResolvedValue([
      { id: "openai", name: "OpenAI", available: false, reason: "run /connect openai" },
      { id: "ollama", name: "Ollama", available: true, reason: "running" },
    ]);

    const result = await handleSlashCommand({
      text: "/providers",
      app,
      session: new Session(`test-providers-${Date.now()}`),
      ...createSlashArgs(),
    });

    expect(result.handled).toBe(true);
    expect(opened[0]?.title).toBe("Providers");
    expect(opened[0]?.items.map((item) => item.label)).toEqual(["OpenAI", "Ollama"]);
    opened[0]?.onSelect("openai");
    expect(drafted).toBe("/connect openai");
    expect(app.statusMessage).toContain("Drafted /connect openai");
  });
});
