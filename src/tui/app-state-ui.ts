import { getSettings, updateSetting, type CavemanLevel, type Mode, type ModelPreferenceSlot, type ThinkingLevel } from "../core/config.js";
import { getAvailableThinkingLevels, getEffectiveThinkingLevel } from "../ai/thinking.js";
import type { BudgetReport } from "../core/budget-insights.js";
import { HOME_TIPS } from "./app-shared.js";
import type { BtwBubble, MenuPromptKind, ModelOption, PickerItem, QuestionRequest, QuestionResult, SettingEntry } from "./app-types.js";
import type { Keypress } from "./keypress.js";
import { showQuestion, showQuestionnaire } from "./question-state.js";
import type { Session } from "../core/session.js";

type AppState = any;

export function openModelPicker(
  app: AppState,
  options: ModelOption[],
  onSelect: (providerId: string, modelId: string) => void,
  onPin?: (providerId: string, modelId: string, pinned: boolean) => void,
  onAssign?: (providerId: string, modelId: string, slot: ModelPreferenceSlot) => void,
  initialCursor?: number,
  initialScope: "all" | "scoped" = "all",
  initialQuery = "",
): void {
  const cursorIdx = initialCursor ?? options.findIndex((o) => o.badges?.includes("now") || o.active);
  app.modelPicker = { options, cursor: cursorIdx >= 0 ? cursorIdx : 0, scope: initialScope };
  app.onModelSelect = onSelect;
  app.onModelPin = onPin ?? null;
  app.onModelAssign = onAssign ?? null;
  app.input.setText(`/model ${initialQuery}`.trimEnd());
  if (initialQuery.length === 0) app.openMenuPrompt("model");
  app.drawNow();
}

export function openSettings(app: AppState, entries: SettingEntry[], onToggle: (key: string) => void): void {
  app.settingsPicker = { entries, cursor: 0 };
  app.onSettingToggle = onToggle;
  app.openMenuPrompt("settings");
  app.drawNow();
}

export function updateModelPickerOptions(app: AppState, options: ModelOption[], focusKey?: string): void {
  if (!app.modelPicker) return;
  app.modelPicker.options = options;
  const filtered = app.getFilteredModels();
  if (focusKey) {
    const idx = filtered.findIndex((option: ModelOption) => `${option.providerId}/${option.modelId}` === focusKey);
    app.modelPicker.cursor = idx >= 0 ? idx : app.clampMenuCursor(app.modelPicker.cursor, filtered.length);
  } else {
    app.modelPicker.cursor = app.clampMenuCursor(app.modelPicker.cursor, filtered.length);
  }
  app.draw();
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
  app.budgetView = { title, reports, scope, section: scope === "session" ? "context" : "usage", scrollOffset: 0 };
  app.drawNow();
}

export function closeBudgetView(app: AppState): void {
  app.budgetView = null;
  app.drawNow();
}

export function openTreeView(app: AppState, title: string, session: Session, onSelect: (entryId: string) => void | Promise<void>): void {
  app.treeView = {
    title,
    session,
    filterMode: "default",
    selectedId: session.getLeafId(),
    scrollOffset: 0,
    collapsedIds: new Set<string>(),
    showLabelTimestamps: false,
  };
  app.onTreeSelect = onSelect;
  app.openMenuPrompt("tree");
  app.drawNow();
}

export function closeTreeView(app: AppState): void {
  app.treeView = null;
  app.onTreeSelect = null;
  app.input.clear();
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
  const settings = getSettings();
  const levels = getAvailableThinkingLevels({
    providerId: app.modelProviderId,
    modelId: app.modelName === "none" ? undefined : app.modelName,
    runtime: app.modelRuntime,
  });
  const current = getEffectiveThinkingLevel({
    providerId: app.modelProviderId,
    modelId: app.modelName === "none" ? undefined : app.modelName,
    runtime: app.modelRuntime,
    level: settings.thinkingLevel,
    enabled: settings.enableThinking,
  });
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

export function assignModelSlot(app: AppState, cursor: number, slot: ModelPreferenceSlot): void {
  if (!app.modelPicker || !app.onModelAssign) return;
  const filtered = app.getFilteredModels();
  const option = filtered[cursor];
  if (!option) return;
  app.onModelAssign(option.providerId, option.modelId, slot);
  app.draw();
}

export function openBtwBubble(app: AppState, bubble: Omit<BtwBubble, "answer"> & { answer?: string }): void {
  app.btwBubble = {
    question: bubble.question,
    answer: bubble.answer ?? "",
    modelLabel: bubble.modelLabel,
    pending: bubble.pending,
    error: bubble.error,
    abort: bubble.abort,
  };
  if (bubble.pending) app.ensureUiSpinner();
  else app.releaseUiSpinnerIfIdle();
  app.draw();
}

export function appendBtwBubble(app: AppState, delta: string): void {
  if (!app.btwBubble) return;
  app.btwBubble.answer += delta;
  app.draw();
}

export function finishBtwBubble(app: AppState, options?: { error?: string }): void {
  if (!app.btwBubble) return;
  app.btwBubble.pending = false;
  app.btwBubble.abort = undefined;
  if (options?.error) app.btwBubble.error = options.error;
  app.releaseUiSpinnerIfIdle();
  app.draw();
}

export function dismissBtwBubble(app: AppState): void {
  if (!app.btwBubble) return;
  const abort = app.btwBubble.abort;
  app.btwBubble = null;
  abort?.();
  app.releaseUiSpinnerIfIdle();
  app.draw();
}

export interface AppStateUiMethods {
  openModelPicker(options: ModelOption[], onSelect: (providerId: string, modelId: string) => void, onPin?: (providerId: string, modelId: string, pinned: boolean) => void, onAssign?: (providerId: string, modelId: string, slot: ModelPreferenceSlot) => void, initialCursor?: number, initialScope?: "all" | "scoped"): void;
  updateModelPickerOptions(options: ModelOption[], focusKey?: string): void;
  openSettings(entries: SettingEntry[], onToggle: (key: string) => void): void;
  updateSettings(entries: SettingEntry[]): void;
  updateItemPickerItems(items: PickerItem[], focusId?: string): void;
  openItemPicker(title: string, items: PickerItem[], onSelect: (id: string) => void, options?: { initialCursor?: number; previewHint?: string; onPreview?: (id: string) => void; onCancel?: () => void; onSecondaryAction?: (id: string) => void; onKey?: (key: Keypress) => boolean; secondaryHint?: string; closeOnSelect?: boolean; kind?: MenuPromptKind }): void;
  openBudgetView(title: string, reports: { all: BudgetReport; session: BudgetReport }, scope?: "all" | "session"): void;
  closeBudgetView(): void;
  openTreeView(title: string, session: Session, onSelect: (entryId: string) => void | Promise<void>): void;
  closeTreeView(): void;
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
  assignModelSlot(cursor: number, slot: ModelPreferenceSlot): void;
  openBtwBubble(bubble: Omit<BtwBubble, "answer"> & { answer?: string }): void;
  appendBtwBubble(delta: string): void;
  finishBtwBubble(options?: { error?: string }): void;
  dismissBtwBubble(): void;
}

export const appStateUiMethods: AppStateUiMethods = {
  openModelPicker(this: AppState, options, onSelect, onPin, onAssign, initialCursor, initialScope) { return openModelPicker(this, options, onSelect, onPin, onAssign, initialCursor, initialScope); },
  updateModelPickerOptions(this: AppState, options, focusKey) { return updateModelPickerOptions(this, options, focusKey); },
  openSettings(this: AppState, entries, onToggle) { return openSettings(this, entries, onToggle); },
  updateSettings(this: AppState, entries) { return updateSettings(this, entries); },
  updateItemPickerItems(this: AppState, items, focusId) { return updateItemPickerItems(this, items, focusId); },
  openItemPicker(this: AppState, title, items, onSelect, options) { return openItemPicker(this, title, items, onSelect, options); },
  openBudgetView(this: AppState, title, reports, scope) { return openBudgetView(this, title, reports, scope); },
  closeBudgetView(this: AppState) { return closeBudgetView(this); },
  openTreeView(this: AppState, title, session, onSelect) { return openTreeView(this, title, session, onSelect); },
  closeTreeView(this: AppState) { return closeTreeView(this); },
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
  assignModelSlot(this: AppState, cursor, slot) { return assignModelSlot(this, cursor, slot); },
  openBtwBubble(this: AppState, bubble) { return openBtwBubble(this, bubble); },
  appendBtwBubble(this: AppState, delta) { return appendBtwBubble(this, delta); },
  finishBtwBubble(this: AppState, options) { return finishBtwBubble(this, options); },
  dismissBtwBubble(this: AppState) { return dismissBtwBubble(this); },
};
