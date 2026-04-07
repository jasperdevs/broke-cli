import type { ModelHandle } from "../ai/providers.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import type { BudgetReport } from "../core/budget-insights.js";
import type { Mode, ModelPreferenceSlot, Settings } from "../core/config.js";
import type { Session } from "../core/session.js";
import type { ModelOption, PickerItem, SettingEntry, UpdateNotice } from "../tui/app-types.js";
import type { Keypress } from "../tui/keypress.js";

export interface SlashCommandApp {
  addMessage(role: "user" | "assistant" | "system", content: string): void;
  clearMessages(): void;
  resetCost(): void;
  setModel(provider: string, model: string, meta?: { providerId?: string; runtime?: import("../ai/providers.js").ModelRuntime }): void;
  setSessionName?(name: string): void;
  setDraft?(text: string): void;
  setStatus?(message: string): void;
  updateUsage(cost: number, inputTokens: number, outputTokens: number): void;
  openModelPicker(
    options: ModelOption[],
    onSelect: (providerId: string, modelId: string) => void,
    onPin?: (providerId: string, modelId: string, pinned: boolean) => void,
    onAssign?: (providerId: string, modelId: string, slot: ModelPreferenceSlot) => void,
    initialCursor?: number,
    initialScope?: "all" | "scoped",
  ): void;
  updateModelPickerOptions?(options: ModelOption[], focusKey?: string): void;
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
      onKey?: (key: Keypress) => boolean;
      secondaryHint?: string;
      closeOnSelect?: boolean;
      kind?: "login" | "connect" | "mode" | "name" | "permissions" | "extensions" | "theme" | "export" | "resume" | "session" | "hotkeys" | "tree" | "templates" | "skills" | "changelog" | "projects" | "logout";
    },
  ): void;
  openTreeView?(title: string, session: Session, onSelect: (entryId: string) => void | Promise<void>): void;
  stop(): void;
  cycleCavemanMode(): void;
  cycleThinkingMode(): void;
  getLastAssistantContent(): string;
  getFileContexts(): Map<string, string>;
  showQuestion(prompt: string, options?: string[]): Promise<string>;
  updateItemPickerItems?(items: PickerItem[], focusId?: string): void;
  setCompacting?(compacting: boolean, tokenCount?: number): void;
  runExternalCommand?(title: string, command: string, args: string[]): number;
  setUpdateNotice?(notice: UpdateNotice | null): void;
  clearUpdateNotice?(): void;
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
  onModeChange: (mode: Mode) => void;
  onModelRoutingChange?: () => void;
  onSystemPromptChange: (systemPrompt: string) => void;
  onBtw?: (question: string) => Promise<void>;
  hooks: ExtensionHooks;
  onProjectChange: (cwd: string) => void;
}
