import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { loadConfig, updateSetting } from "../src/core/config.js";

export function createAppStub() {
  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
  return {
    messages,
    statusMessage: "",
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
    setSessionName() {},
    setDraft() {},
    setStatus(message: string) {
      this.statusMessage = message;
    },
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
    runExternalCommand() {
      return 0;
    },
    openBudgetView() {},
    openTreeView() {},
  };
}

export function createSlashArgs(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

export const localTemplateDir = join(process.cwd(), ".brokecli", "prompts");
export const templatePath = join(localTemplateDir, "slash-test-template.md");
export const coreTemplatePath = join(localTemplateDir, "slash-test-template-core.md");
export const uiTemplatePath = join(localTemplateDir, "slash-test-template-ui.md");
export const configPath = join(homedir(), ".brokecli", "config.json");
export const authPath = join(homedir(), ".brokecli", "auth.json");
export const extDir = join(homedir(), ".brokecli", "extensions");
export const extPath = join(extDir, "slash-test-extension.js");

export function cleanupSlashCommandFixtures(): void {
  if (existsSync(templatePath)) rmSync(templatePath, { force: true });
  if (existsSync(extPath)) rmSync(extPath, { force: true });
  updateSetting("disabledExtensions", (loadConfig().settings?.disabledExtensions ?? []).filter((entry) => entry !== "slash-test-extension"));
}

export {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
};
