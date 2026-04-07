import { getSettings, updateSetting, type CavemanLevel, type Mode, type ThinkingLevel } from "../core/config.js";
import type { BudgetReport } from "../core/budget-insights.js";
import { HOME_TIPS } from "./app-shared.js";
import type { AgentRun, MenuPromptKind, ModelOption, PickerItem, QuestionRequest, QuestionResult, SettingEntry } from "./app-types.js";
import type { Keypress } from "./keypress.js";
import { showQuestion, showQuestionnaire } from "./question-state.js";

type AppState = any;

export function openModelPicker(
  app: AppState,
  options: ModelOption[],
  onSelect: (providerId: string, modelId: string) => void,
  onPin?: (providerId: string, modelId: string, pinned: boolean) => void,
  initialCursor?: number,
  initialScope: "all" | "scoped" = "all",
): void {
  const cursorIdx = initialCursor ?? options.findIndex((o) => o.active);
  app.modelPicker = { options, cursor: cursorIdx >= 0 ? cursorIdx : 0, scope: initialScope };
  app.onModelSelect = onSelect;
  app.onModelPin = onPin ?? null;
  app.openMenuPrompt("model");
  app.drawNow();
}

export function openSettings(app: AppState, entries: SettingEntry[], onToggle: (key: string) => void): void {
  app.settingsPicker = { entries, cursor: 0 };
  app.onSettingToggle = onToggle;
  app.openMenuPrompt("settings");
  app.drawNow();
}

export function updateSettings(app: AppState, entries: SettingEntry[]): void {
  if (app.settingsPicker) {
    app.settingsPicker.entries = entries;
    app.draw();
  }
}

export function updateItemPickerItems(app: AppState, items: PickerItem[], focusId?: string): void {
  if (!app.itemPicker) return;
  app.itemPicker.items = items;
  if (focusId) {
    const idx = app.getFilteredItems().findIndex((item: PickerItem) => item.id === focusId);
    app.itemPicker.cursor = idx >= 0 ? idx : 0;
  } else {
    app.itemPicker.cursor = app.clampMenuCursor(app.itemPicker.cursor, app.getFilteredItems().length);
  }
  app.draw();
}

export function openItemPicker(
  app: AppState,
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
    kind?: MenuPromptKind;
  },
): void {
  const cursor = app.clampMenuCursor(options?.initialCursor ?? 0, items.length);
  app.itemPicker = {
    title,
    items,
    cursor,
    kind: options?.kind,
    previewHint: options?.previewHint,
    onPreview: options?.onPreview,
    onCancel: options?.onCancel,
    onSecondaryAction: options?.onSecondaryAction,
    onKey: options?.onKey,
    secondaryHint: options?.secondaryHint,
    closeOnSelect: options?.closeOnSelect ?? true,
  };
  app.onItemSelect = onSelect;
  if (options?.kind) app.openMenuPrompt(options.kind);
  app.drawNow();
}

export function openBudgetView(
  app: AppState,
  title: string,
  reports: { all: BudgetReport; session: BudgetReport },
  scope: "all" | "session" = "all",
): void {
  app.budgetView = { title, reports, scope, scrollOffset: 0 };
  app.drawNow();
}

export function closeBudgetView(app: AppState): void {
  app.budgetView = null;
  app.drawNow();
}

export function openAgentRunsView(app: AppState, title: string, runs: AgentRun[]): void {
  app.agentRunView = {
    title,
    runs,
    selectedIndex: Math.max(0, runs.length - 1),
    scrollOffset: 0,
  };
  app.drawNow();
}

export function closeAgentRunsView(app: AppState): void {
  app.agentRunView = null;
  app.drawNow();
}

export function getMode(app: AppState): Mode { return app.mode; }

export function setMode(app: AppState, mode: Mode): void {
  app.mode = mode;
  app.draw();
}

export function setCwd(app: AppState, cwd: string): void {
  app.cwd = cwd;
  app.projectFiles = null;
  app.fileContexts.clear();
  app.sidebarFileTree = null;
  app.sidebarExpandedDirs.clear();
  app.homeTip = HOME_TIPS[app.pickHomeTipIndex()];
  app.draw();
}

export function onModeToggle(app: AppState, callback: (mode: Mode) => void): void { app.onModeChange = callback; }
export function onThinkingToggle(app: AppState, callback: (level: ThinkingLevel) => void): void { app.onThinkingChange = callback; }

export function cycleThinkingMode(app: AppState): void {
  const levels: ThinkingLevel[] = ["off", "low", "medium", "high"];
  const settings = getSettings();
  const current = settings.thinkingLevel || (settings.enableThinking ? "low" : "off");
  const idx = levels.indexOf(current);
  const next = levels[(idx + 1) % levels.length];
  updateSetting("thinkingLevel", next);
  updateSetting("enableThinking", next !== "off");
  if (app.onThinkingChange) app.onThinkingChange(next);
  app.draw();
}

export function onCavemanToggle(app: AppState, callback: (level: CavemanLevel) => void): void { app.onCavemanChange = callback; }

export function cycleCavemanMode(app: AppState): void {
  const levels: CavemanLevel[] = ["off", "lite", "auto", "ultra"];
  const settings = getSettings();
  const current = settings.cavemanLevel ?? "auto";
  const idx = levels.indexOf(current);
  const next = levels[(idx + 1) % levels.length];
  updateSetting("cavemanLevel", next);
  if (app.onCavemanChange) app.onCavemanChange(next);
  app.draw();
}

export function onScopedModelCycle(app: AppState, handler: () => void): void { app.onCycleScopedModel = handler; }

export interface AppStateUiMethods {
  openModelPicker(options: ModelOption[], onSelect: (providerId: string, modelId: string) => void, onPin?: (providerId: string, modelId: string, pinned: boolean) => void, initialCursor?: number, initialScope?: "all" | "scoped"): void;
  openSettings(entries: SettingEntry[], onToggle: (key: string) => void): void;
  updateSettings(entries: SettingEntry[]): void;
  updateItemPickerItems(items: PickerItem[], focusId?: string): void;
  openItemPicker(title: string, items: PickerItem[], onSelect: (id: string) => void, options?: { initialCursor?: number; previewHint?: string; onPreview?: (id: string) => void; onCancel?: () => void; onSecondaryAction?: (id: string) => void; onKey?: (key: Keypress) => boolean; secondaryHint?: string; closeOnSelect?: boolean; kind?: MenuPromptKind }): void;
  openBudgetView(title: string, reports: { all: BudgetReport; session: BudgetReport }, scope?: "all" | "session"): void;
  closeBudgetView(): void;
  openAgentRunsView(title: string, runs: AgentRun[]): void;
  closeAgentRunsView(): void;
  getMode(): Mode;
  setMode(mode: Mode): void;
  setCwd(cwd: string): void;
  onModeToggle(callback: (mode: Mode) => void): void;
  onThinkingToggle(callback: (level: ThinkingLevel) => void): void;
  cycleThinkingMode(): void;
  onCavemanToggle(callback: (level: CavemanLevel) => void): void;
  cycleCavemanMode(): void;
  showQuestion(question: string, options?: string[]): Promise<string>;
  showQuestionnaire(request: QuestionRequest): Promise<QuestionResult>;
  onScopedModelCycle(handler: () => void): void;
}

export const appStateUiMethods: AppStateUiMethods = {
  openModelPicker(this: AppState, options, onSelect, onPin, initialCursor, initialScope) { return openModelPicker(this, options, onSelect, onPin, initialCursor, initialScope); },
  openSettings(this: AppState, entries, onToggle) { return openSettings(this, entries, onToggle); },
  updateSettings(this: AppState, entries) { return updateSettings(this, entries); },
  updateItemPickerItems(this: AppState, items, focusId) { return updateItemPickerItems(this, items, focusId); },
  openItemPicker(this: AppState, title, items, onSelect, options) { return openItemPicker(this, title, items, onSelect, options); },
  openBudgetView(this: AppState, title, reports, scope) { return openBudgetView(this, title, reports, scope); },
  closeBudgetView(this: AppState) { return closeBudgetView(this); },
  openAgentRunsView(this: AppState, title, runs) { return openAgentRunsView(this, title, runs); },
  closeAgentRunsView(this: AppState) { return closeAgentRunsView(this); },
  getMode(this: AppState) { return getMode(this); },
  setMode(this: AppState, mode) { return setMode(this, mode); },
  setCwd(this: AppState, cwd) { return setCwd(this, cwd); },
  onModeToggle(this: AppState, callback) { return onModeToggle(this, callback); },
  onThinkingToggle(this: AppState, callback) { return onThinkingToggle(this, callback); },
  cycleThinkingMode(this: AppState) { return cycleThinkingMode(this); },
  onCavemanToggle(this: AppState, callback) { return onCavemanToggle(this, callback); },
  cycleCavemanMode(this: AppState) { return cycleCavemanMode(this); },
  showQuestion(this: AppState, question, options) { return showQuestion(this, question, options); },
  showQuestionnaire(this: AppState, request) { return showQuestionnaire(this, request); },
  onScopedModelCycle(this: AppState, handler) { return onScopedModelCycle(this, handler); },
};
