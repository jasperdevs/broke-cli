import { getSettings, updateSetting, type CavemanLevel, type Mode, type ThinkingLevel } from "../core/config.js";
import { HOME_TIPS } from "./app-shared.js";
import type { MenuPromptKind, ModelOption, PendingImage, PickerItem, SettingEntry, TodoItem } from "./app-types.js";

type AppState = any;

export function openModelPicker(app: AppState, options: ModelOption[], onSelect: (providerId: string, modelId: string) => void, onPin?: (providerId: string, modelId: string, pinned: boolean) => void, initialCursor?: number): void {
  const cursorIdx = initialCursor ?? options.findIndex((o) => o.active);
  app.modelPicker = { options, cursor: cursorIdx >= 0 ? cursorIdx : 0, scope: "all" };
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
    secondaryHint: options?.secondaryHint,
    closeOnSelect: options?.closeOnSelect ?? true,
  };
  app.onItemSelect = onSelect;
  if (options?.kind) app.openMenuPrompt(options.kind);
  app.drawNow();
}

export function openBudgetView(app: AppState, title: string, lines: string[]): void {
  app.budgetView = { title, lines, scrollOffset: 0 };
  app.drawNow();
}

export function closeBudgetView(app: AppState): void {
  app.budgetView = null;
  app.drawNow();
}

export function clearMessages(app: AppState): void {
  app.messages = [];
  app.scrollOffset = 0;
  app.refreshHomeScreenData();
  app.invalidateMsgCache();
  app.screen.forceRedraw([]);
  app.draw();
}

export function addMessage(app: AppState, role: "user" | "assistant" | "system", content: string, images?: PendingImage[]): void {
  if (role === "user") {
    app.thinkingBuffer = "";
    app.thinkingStartTime = 0;
    app.thinkingDuration = 0;
  }
  app.messages.push({ role, content, images });
  app.invalidateMsgCache();
  app.scrollToBottom();
  app.draw();
}

export function appendToLastMessage(app: AppState, text: string): void {
  if (app.thinkingStartTime > 0 && app.thinkingBuffer) {
    app.thinkingDuration = Math.floor((Date.now() - app.thinkingStartTime) / 1000);
    app.thinkingStartTime = 0;
  }
  const last = app.messages[app.messages.length - 1];
  if (last && last.role === "assistant") last.content += text;
  else app.messages.push({ role: "assistant", content: text });
  app.invalidateMsgCache();
  app.scrollToBottom();
  app.draw();
}

export function appendThinking(app: AppState, delta: string): void {
  if (!app.thinkingBuffer && delta) app.thinkingStartTime = Date.now();
  app.thinkingBuffer += delta;
  app.scrollToBottom();
  app.draw();
}

export function updateTodo(app: AppState, items: TodoItem[]): void {
  app.todoItems = items;
  app.invalidateMsgCache();
  app.draw();
}

export function addToolCall(app: AppState, name: string, preview: string, args?: unknown): void {
  app.toolCallGroups.push({ name, preview, args, expanded: app.allToolsExpanded });
  const maxW = app.screen.mainWidth - 4;
  const tc = app.toolCallGroups[app.toolCallGroups.length - 1];
  const block = app.renderToolCallBlock(tc, maxW);
  if (block.length > 0) app.messages.push({ role: "system", content: block.join("\n") });
  app.invalidateMsgCache();
  app.scrollToBottom();
  app.draw();
}

export function updateToolCallArgs(app: AppState, name: string, preview: string, args: unknown): void {
  for (let i = app.toolCallGroups.length - 1; i >= 0; i--) {
    const tc = app.toolCallGroups[i];
    if (tc.name === name && !tc.result) {
      tc.preview = preview;
      tc.args = args;
      const maxW = app.screen.mainWidth - 4;
      const block = app.renderToolCallBlock(tc, maxW);
      for (let j = app.messages.length - 1; j >= 0; j--) {
        if (app.messages[j].role === "system" && app.messages[j].content.includes("...")) {
          app.messages[j].content = block.join("\n");
          break;
        }
      }
      app.invalidateMsgCache();
      app.draw();
      return;
    }
  }
  app.addToolCall(name, preview, args);
}

export function addToolResult(app: AppState, name: string, result: string, error?: boolean, resultDetail?: string): void {
  for (let i = app.toolCallGroups.length - 1; i >= 0; i--) {
    if (app.toolCallGroups[i].name === name && !app.toolCallGroups[i].result) {
      app.toolCallGroups[i].result = result;
      app.toolCallGroups[i].error = error;
      app.toolCallGroups[i].resultDetail = resultDetail;
      const maxW = app.screen.mainWidth - 4;
      const block = app.renderToolCallBlock(app.toolCallGroups[i], maxW);
      for (let j = app.messages.length - 1; j >= 0; j--) {
        if (app.messages[j].role === "system" && app.messages[j].content.includes(app.toolCallGroups[i].preview)) {
          app.messages[j].content = block.join("\n");
          break;
        }
      }
      break;
    }
  }
  app.invalidateMsgCache();
  app.scrollToBottom();
  app.draw();
}

export function setStreamTokens(app: AppState, tokens: number): void {
  app.streamTokens = tokens;
  app.animStreamTokens.set(tokens);
  if (!app.isStreaming) app.animStreamTokens.sync();
}

export function setCompacting(app: AppState, compacting: boolean, tokenCount?: number): void {
  app.isCompacting = compacting;
  if (compacting) {
    app.compactStartTime = Date.now();
    app.compactTokens = tokenCount ?? 0;
    app.invalidateMsgCache();
    app.scrollToBottom();
    if (!app.spinnerTimer) {
      app.spinnerFrame = 0;
      app.spinnerTimer = setInterval(() => {
        app.spinnerFrame++;
        app.draw();
      }, app.constructor.ANIMATION_INTERVAL_MS);
    }
  } else if (!app.isStreaming && app.spinnerTimer) {
    clearInterval(app.spinnerTimer);
    app.spinnerTimer = null;
  }
  app.draw();
}

export function appendToolOutput(app: AppState, chunk: string): void {
  for (let i = app.toolCallGroups.length - 1; i >= 0; i--) {
    const tc = app.toolCallGroups[i];
    if (tc.name === "bash" && !tc.result) {
      tc.streamOutput = (tc.streamOutput ?? "") + chunk;
      const maxW = app.screen.mainWidth - 4;
      const block = app.renderToolCallBlock(tc, maxW);
      for (let j = app.messages.length - 1; j >= 0; j--) {
        if (app.messages[j].role === "system" && app.messages[j].content.includes(tc.preview)) {
          app.messages[j].content = block.join("\n");
          break;
        }
      }
      app.invalidateMsgCache();
      app.scrollToBottom();
      app.draw();
      return;
    }
  }
}

export function collapseToolCalls(app: AppState): void { app.toolCallGroups = []; }

export function getLastAssistantContent(app: AppState): string {
  for (let i = app.messages.length - 1; i >= 0; i--) {
    if (app.messages[i].role === "assistant") return app.messages[i].content;
  }
  return "";
}

export function getFileContexts(app: AppState): Map<string, string> {
  const ctx = new Map<string, string>(app.fileContexts);
  app.fileContexts.clear();
  return ctx;
}

export function setStatus(app: AppState, message: string): void {
  app.statusMessage = message;
  app.draw();
}

export function clearStatus(app: AppState): void {
  app.statusMessage = undefined;
  app.draw();
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
  const current = settings.cavemanLevel ?? "off";
  const idx = levels.indexOf(current);
  const next = levels[(idx + 1) % levels.length];
  updateSetting("cavemanLevel", next);
  if (app.onCavemanChange) app.onCavemanChange(next);
  app.draw();
}

export function onInput(app: AppState, handler: (text: string, images?: PendingImage[]) => void): void {
  app.onSubmit = handler as (text: string) => void;
}

export function onPendingMessagesReadyHandler(app: AppState, handler: () => void): void {
  app.onPendingMessagesReady = handler;
}

export function takePendingImages(app: AppState): PendingImage[] {
  const images = app.pendingImages;
  app.pendingImages = [];
  return images;
}

export function addPendingMessage(app: AppState, text: string, images?: PendingImage[]): void {
  app.pendingMessages.push({ text, images });
  app.draw();
}

export function takePendingMessages(app: AppState): Array<{ text: string; images?: PendingImage[] }> {
  const messages = app.pendingMessages;
  app.pendingMessages = [];
  return messages;
}

export function hasPendingMessages(app: AppState): boolean { return app.pendingMessages.length > 0; }
export function getPendingMessagesCount(app: AppState): number { return app.pendingMessages.length; }

export function flushPendingMessages(app: AppState): void {
  if (app.onPendingMessagesReady) app.onPendingMessagesReady();
}

export function showQuestion(app: AppState, question: string, options?: string[]): Promise<string> {
  return new Promise((resolve) => {
    app.questionPrompt = {
      question,
      options: options && options.length > 0 ? options : undefined,
      cursor: 0,
      textInput: "",
      resolve,
    };
    app.drawNow();
  });
}

export function onAbortRequest(app: AppState, handler: () => void): void { app.onAbort = handler; }
export function onScopedModelCycle(app: AppState, handler: () => void): void { app.onCycleScopedModel = handler; }

export interface AppStateUiMethods {
  openModelPicker(options: ModelOption[], onSelect: (providerId: string, modelId: string) => void, onPin?: (providerId: string, modelId: string, pinned: boolean) => void, initialCursor?: number): void;
  openSettings(entries: SettingEntry[], onToggle: (key: string) => void): void;
  updateSettings(entries: SettingEntry[]): void;
  updateItemPickerItems(items: PickerItem[], focusId?: string): void;
  openItemPicker(title: string, items: PickerItem[], onSelect: (id: string) => void, options?: { initialCursor?: number; previewHint?: string; onPreview?: (id: string) => void; onCancel?: () => void; onSecondaryAction?: (id: string) => void; secondaryHint?: string; closeOnSelect?: boolean; kind?: MenuPromptKind }): void;
  openBudgetView(title: string, lines: string[]): void;
  closeBudgetView(): void;
  clearMessages(): void;
  addMessage(role: "user" | "assistant" | "system", content: string, images?: PendingImage[]): void;
  appendToLastMessage(text: string): void;
  appendThinking(delta: string): void;
  updateTodo(items: TodoItem[]): void;
  addToolCall(name: string, preview: string, args?: unknown): void;
  updateToolCallArgs(name: string, preview: string, args: unknown): void;
  addToolResult(name: string, result: string, error?: boolean, resultDetail?: string): void;
  setStreamTokens(tokens: number): void;
  setCompacting(compacting: boolean, tokenCount?: number): void;
  appendToolOutput(chunk: string): void;
  collapseToolCalls(): void;
  getLastAssistantContent(): string;
  getFileContexts(): Map<string, string>;
  setStatus(message: string): void;
  clearStatus(): void;
  getMode(): Mode;
  setMode(mode: Mode): void;
  setCwd(cwd: string): void;
  onModeToggle(callback: (mode: Mode) => void): void;
  onThinkingToggle(callback: (level: ThinkingLevel) => void): void;
  cycleThinkingMode(): void;
  onCavemanToggle(callback: (level: CavemanLevel) => void): void;
  cycleCavemanMode(): void;
  onInput(handler: (text: string, images?: PendingImage[]) => void): void;
  onPendingMessagesReadyHandler(handler: () => void): void;
  takePendingImages(): PendingImage[];
  addPendingMessage(text: string, images?: PendingImage[]): void;
  takePendingMessages(): Array<{ text: string; images?: PendingImage[] }>;
  hasPendingMessages(): boolean;
  getPendingMessagesCount(): number;
  flushPendingMessages(): void;
  showQuestion(question: string, options?: string[]): Promise<string>;
  onAbortRequest(handler: () => void): void;
  onScopedModelCycle(handler: () => void): void;
}

export const appStateUiMethods: AppStateUiMethods = {
  openModelPicker(this: AppState, options, onSelect, onPin, initialCursor) { return openModelPicker(this, options, onSelect, onPin, initialCursor); },
  openSettings(this: AppState, entries, onToggle) { return openSettings(this, entries, onToggle); },
  updateSettings(this: AppState, entries) { return updateSettings(this, entries); },
  updateItemPickerItems(this: AppState, items, focusId) { return updateItemPickerItems(this, items, focusId); },
  openItemPicker(this: AppState, title, items, onSelect, options) { return openItemPicker(this, title, items, onSelect, options); },
  openBudgetView(this: AppState, title, lines) { return openBudgetView(this, title, lines); },
  closeBudgetView(this: AppState) { return closeBudgetView(this); },
  clearMessages(this: AppState) { return clearMessages(this); },
  addMessage(this: AppState, role, content, images) { return addMessage(this, role, content, images); },
  appendToLastMessage(this: AppState, text) { return appendToLastMessage(this, text); },
  appendThinking(this: AppState, delta) { return appendThinking(this, delta); },
  updateTodo(this: AppState, items) { return updateTodo(this, items); },
  addToolCall(this: AppState, name, preview, args) { return addToolCall(this, name, preview, args); },
  updateToolCallArgs(this: AppState, name, preview, args) { return updateToolCallArgs(this, name, preview, args); },
  addToolResult(this: AppState, name, result, error, resultDetail) { return addToolResult(this, name, result, error, resultDetail); },
  setStreamTokens(this: AppState, tokens) { return setStreamTokens(this, tokens); },
  setCompacting(this: AppState, compacting, tokenCount) { return setCompacting(this, compacting, tokenCount); },
  appendToolOutput(this: AppState, chunk) { return appendToolOutput(this, chunk); },
  collapseToolCalls(this: AppState) { return collapseToolCalls(this); },
  getLastAssistantContent(this: AppState) { return getLastAssistantContent(this); },
  getFileContexts(this: AppState) { return getFileContexts(this); },
  setStatus(this: AppState, message) { return setStatus(this, message); },
  clearStatus(this: AppState) { return clearStatus(this); },
  getMode(this: AppState) { return getMode(this); },
  setMode(this: AppState, mode) { return setMode(this, mode); },
  setCwd(this: AppState, cwd) { return setCwd(this, cwd); },
  onModeToggle(this: AppState, callback) { return onModeToggle(this, callback); },
  onThinkingToggle(this: AppState, callback) { return onThinkingToggle(this, callback); },
  cycleThinkingMode(this: AppState) { return cycleThinkingMode(this); },
  onCavemanToggle(this: AppState, callback) { return onCavemanToggle(this, callback); },
  cycleCavemanMode(this: AppState) { return cycleCavemanMode(this); },
  onInput(this: AppState, handler) { return onInput(this, handler); },
  onPendingMessagesReadyHandler(this: AppState, handler) { return onPendingMessagesReadyHandler(this, handler); },
  takePendingImages(this: AppState) { return takePendingImages(this); },
  addPendingMessage(this: AppState, text, images) { return addPendingMessage(this, text, images); },
  takePendingMessages(this: AppState) { return takePendingMessages(this); },
  hasPendingMessages(this: AppState) { return hasPendingMessages(this); },
  getPendingMessagesCount(this: AppState) { return getPendingMessagesCount(this); },
  flushPendingMessages(this: AppState) { return flushPendingMessages(this); },
  showQuestion(this: AppState, question, options) { return showQuestion(this, question, options); },
  onAbortRequest(this: AppState, handler) { return onAbortRequest(this, handler); },
  onScopedModelCycle(this: AppState, handler) { return onScopedModelCycle(this, handler); },
};
