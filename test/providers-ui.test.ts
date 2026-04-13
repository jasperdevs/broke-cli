import { afterEach, describe, expect, it, vi } from "vitest";
import * as detect from "../src/ai/detect.js";
import * as connectFlow from "../src/cli/connect-flow.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { Session } from "../src/core/session.js";
import { cleanupSlashCommandFixtures, createAppStub, createSlashArgs } from "./slash-command-test-helpers.js";

afterEach(() => {
  cleanupSlashCommandFixtures();
  vi.restoreAllMocks();
});

describe("provider diagnostics UI", () => {
  it("shows provider diagnostics in a picker and starts the relevant connect flow", async () => {
    const app = createAppStub();
    const opened: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }>; onSelect: (id: string) => void }> = [];
    app.openItemPicker = (title: string, items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      opened.push({ title, items, onSelect: nextOnSelect });
    };
    vi.spyOn(connectFlow, "runConnectFlow").mockResolvedValue();
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
    await opened[0]?.onSelect("openai");
    expect(connectFlow.runConnectFlow).toHaveBeenCalled();
    expect(app.statusMessage).toContain("started /connect openai");
  });
});
