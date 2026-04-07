import type { ModelHandle } from "../ai/providers.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import type { BudgetReport } from "../core/budget-insights.js";
import type { Mode, Settings } from "../core/config.js";
import type { Session } from "../core/session.js";
import type { ModelOption, PickerItem, SettingEntry, UpdateNotice } from "../tui/app-types.js";

export interface SlashCommandApp {
  addMessage(role: "user" | "assistant" | "system", content: string): void;
  clearMessages(): void;
  resetCost(): void;
  setModel(provider: string, model: string): void;
  setSessionName?(name: string): void;
  setDraft?(text: string): void;
  updateUsage(cost: number, inputTokens: number, outputTokens: number): void;
  openModelPicker(
    options: ModelOption[],
    onSelect: (providerId: string, modelId: string) => void,
    onPin?: (providerId: string, modelId: string, pinned: boolean) => void,
    initialCursor?: number,
    initialScope?: "all" | "scoped",
  ): void;
  openSettings(entries: SettingEntry[], onToggle: (key: string) => void): void;
  updateSettings(entries: SettingEntry[]): void;
  openItemPicker(
    title: string,
    items: PickerItem[],
    onSelect: (id: string) => void,
    options?: {
      initialCursor?: number;
      previewHint?: string;
      onPreview?: (id: string) => void;
      onCancel?: () => void;
      onSecondaryAction?: (id: string) => void;
      secondaryHint?: string;
      closeOnSelect?: boolean;
      kind?: "login" | "connect" | "permissions" | "extensions" | "theme" | "export" | "resume" | "session" | "hotkeys" | "agents" | "templates" | "skills" | "changelog" | "projects" | "logout";
    },
  ): void;
  openAgentRunsView?(title: string, runs: Array<{ id: string; prompt: string; status: "running" | "done" | "error"; result?: string; detail?: string; createdAt: number }>): void;
  getAgentRuns?(): Array<{ id: string; prompt: string; status: "running" | "done" | "error"; result?: string; detail?: string; createdAt: number }>;
  stop(): void;
  cycleCavemanMode(): void;
  cycleThinkingMode(): void;
  getLastAssistantContent(): string;
  getFileContexts(): Map<string, string>;
  showQuestion(prompt: string, options?: string[]): Promise<string>;
  runExternalCommand?(title: string, command: string, args: string[]): number;
  setUpdateNotice?(notice: UpdateNotice | null): void;
  clearUpdateNotice?(): void;
  updateItemPickerItems?(items: PickerItem[], focusId?: string): void;
  setCompacting?(compacting: boolean, tokenCount?: number): void;
  openBudgetView?(title: string, reports: { all: BudgetReport; session: BudgetReport }, scope?: "all" | "session"): void;
}

export interface ExtensionHooks {
  emit(event: string, payload: Record<string, unknown>): void;
  reload?(): void;
}

export interface SlashCommandResult {
  handled: boolean;
  templateLoaded?: boolean;
}

export interface HandleSlashCommandOptions {
  text: string;
  app: SlashCommandApp;
  session: Session;
  activeModel: ModelHandle | null;
  currentModelId: string;
  currentMode: Mode;
  systemPrompt: string;
  providerRegistry: ProviderRegistry;
  buildVisibleModelOptions: () => ModelOption[];
  refreshProviderState: (force?: boolean) => Promise<Awaited<ReturnType<ProviderRegistry["refresh"]>>>;
  isSkippedPromptAnswer: (value: string | undefined | null) => boolean;
  isValidHttpBaseUrl: (value: string) => boolean;
  getContextOptimizer: () => ReturnType<Session["getContextOptimizer"]>;
  onSessionReplace: (session: Session) => void;
  onModelChange: (model: ModelHandle, modelId: string) => void;
  onSystemPromptChange: (systemPrompt: string) => void;
  hooks: ExtensionHooks;
  onProjectChange: (cwd: string) => void;
}
