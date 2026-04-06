import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { Session } from "../src/core/session.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";

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

afterEach(() => {
  if (existsSync(templatePath)) rmSync(templatePath, { force: true });
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
    });

    expect(result.handled).toBe(true);
    expect(replaced).not.toBeNull();
    expect(replaced?.getId()).not.toBe(session.getId());
    expect(replaced?.getMessages().map((msg) => msg.content)).toEqual(["hello"]);
  });
});
