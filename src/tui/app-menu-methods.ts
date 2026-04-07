import stripAnsi from "strip-ansi";
import { currentTheme } from "../core/themes.js";
import { getSettings } from "../core/config.js";
import { filterFiles, readFileForContext } from "./file-picker.js";
import type { Keypress } from "./keypress.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { T, TXT, MUTED } from "./app-shared.js";
import { wordWrap } from "./render/formatting.js";
import type { MenuEntry, MenuPromptKind, ModelOption, PickerItem, SettingEntry } from "./app-types.js";

type AppState = any;

export function scrollToBottom(app: AppState): void {
  const chatHeight = app.getChatHeight();
  const messageLines = app.renderMessages(app.screen.mainWidth - 2);
  app.scrollOffset = Math.max(0, messageLines.length - chatHeight);
}

export function getChatHeight(app: AppState): number {
  const headerLines = app.screen.hasSidebar ? 0 : 1;
  const hasSidebar = app.shouldShowSidebar();
  const mainW = hasSidebar ? app.screen.mainWidth : app.screen.width;
  const bottomBase = app.getBottomLineCount(mainW, app.screen.height);
  const footerBase = hasSidebar ? app.renderSidebarFooter().length : 0;
  return Math.max(1, app.screen.height - Math.max(bottomBase, footerBase) - headerLines);
}

export function getBottomLineCount(app: AppState, mainW: number, maxHeight: number): number {
  const inputLineCount = app.getWrappedInputLines(app.input.getText(), mainW).length;
  const tailReserve = 2 + (app.statusMessage ? 1 : 0);
  let count = 0;
  count += 2; // visual gap above the input bar
  count += 1; // separator above the input
  count += inputLineCount;

  const menuBodyCapacity = (sepAlreadyAdded = false): number => {
    const projected = count + (sepAlreadyAdded ? 0 : 1);
    return Math.max(1, maxHeight - projected - tailReserve);
  };

  if (app.filePicker) {
    const entries = app.getFilePickerEntries();
    const visible = Math.min(entries.length, Math.max(1, menuBodyCapacity(true) - 1));
    count += 1; // menu separator
    count += 1; // title
    count += visible;
  } else if (app.itemPicker) {
    const entries = app.getItemPickerEntries();
    const visible = entries.length === 0 ? 1 : Math.min(entries.length, Math.max(1, menuBodyCapacity(true) - 1));
    count += 1; // menu separator
    count += 1; // title
    count += visible;
  } else if (app.settingsPicker) {
    const entries = app.getSettingsPickerEntries();
    const visible = entries.length === 0 ? 1 : Math.min(entries.length, Math.max(1, menuBodyCapacity(true) - 1));
    count += 1; // menu separator
    count += 1; // title
    count += visible;
  } else if (app.modelPicker) {
    const entries = app.getModelPickerEntries();
    const visible = entries.length === 0 ? 1 : Math.min(entries.length, Math.max(1, menuBodyCapacity(true) - 4));
    count += 1; // menu separator
    count += 1; // title
    count += 1; // scope
    count += 2; // hints
    count += visible;
  } else {
    const allSuggestions = app.getCommandSuggestionEntries();
    if (allSuggestions.length > 0) {
      const visible = Math.min(
        allSuggestions.length,
        Math.max(1, Math.min(getSettings().autocompleteMaxVisible, menuBodyCapacity(true) - 1)),
      );
      count += 1; // menu separator
      count += 1; // title
      count += visible;
    }
  }

  count += tailReserve;
  return count;
}

export function getWrappedInputLines(app: AppState, text: string, width: number): string[] {
  const padX = Math.max(0, getSettings().editorPaddingX | 0);
  const usableWidth = Math.max(1, width - 2 - (padX * 2));
  const sourceLines = (text || "").split("\n");
  const wrapped: string[] = [];
  for (const line of sourceLines) {
    const lineParts = line.length === 0 ? [""] : wordWrap(line, usableWidth);
    wrapped.push(...lineParts.map((part) => `${" ".repeat(padX)}${part}`));
  }
  return wrapped.length > 0 ? wrapped : [" ".repeat(padX)];
}

export function getInputCursorLayout(app: AppState, text: string, cursor: number, width: number): { lines: string[]; row: number; col: number } {
  const lines = app.getWrappedInputLines(text, width);
  const beforeCursor = text.slice(0, cursor);
  const cursorLines = app.getWrappedInputLines(beforeCursor, width);
  const currentLine = cursorLines[cursorLines.length - 1] ?? "";
  return { lines, row: Math.max(0, cursorLines.length - 1), col: currentLine.length };
}

export function getFilteredModels(app: AppState): ModelOption[] {
  if (!app.modelPicker) return [];
  const pool = app.modelPicker.scope === "scoped"
    ? app.modelPicker.options.filter((option: ModelOption) => option.active)
    : app.modelPicker.options;
  const q = app.getMenuFilterQuery().toLowerCase();
  const basePool = pool.length > 0 ? pool : app.modelPicker.options;
  if (!q) return basePool;
  return basePool.filter((o: ModelOption) => o.modelId.toLowerCase().includes(q) || o.providerName.toLowerCase().includes(q));
}

export function toggleModelScope(app: AppState): void {
  if (!app.modelPicker) return;
  app.modelPicker.scope = app.modelPicker.scope === "all" ? "scoped" : "all";
  app.modelPicker.cursor = app.clampMenuCursor(app.modelPicker.cursor, app.getFilteredModels().length);
  app.draw();
}

export function getFilteredSettings(app: AppState): SettingEntry[] {
  if (!app.settingsPicker) return [];
  const q = app.getMenuFilterQuery().toLowerCase();
  if (!q) return app.settingsPicker.entries;
  return app.settingsPicker.entries.filter((e: SettingEntry) => e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
}

export function getFilteredItems(app: AppState): PickerItem[] {
  if (!app.itemPicker) return [];
  const q = app.getMenuFilterQuery().toLowerCase();
  if (!q) return app.itemPicker.items;
  return app.itemPicker.items.filter((i: PickerItem) => i.label.toLowerCase().includes(q) || (i.detail ?? "").toLowerCase().includes(q));
}

export function previewCurrentItem(app: AppState): void {
  if (!app.itemPicker?.onPreview) return;
  const item = app.getFilteredItems()[app.itemPicker.cursor];
  if (!item) return;
  app.itemPicker.onPreview(item.id);
}

export function closeItemPicker(app: AppState, revertPreview = false): void {
  if (revertPreview) app.itemPicker?.onCancel?.();
  app.itemPicker = null;
  app.input.clear();
  app.drawNow();
}

export function getMenuPromptPrefix(_app: AppState, kind: MenuPromptKind): string {
  switch (kind) {
    case "model": return "/model ";
    case "mode": return "/mode ";
    case "login": return "/login ";
    case "connect": return "/connect ";
    case "settings": return "/settings ";
    case "permissions": return "/permissions ";
    case "extensions": return "/extensions ";
    case "theme": return "/theme ";
    case "export": return "/export ";
    case "resume": return "/resume ";
    case "session": return "/session ";
    case "hotkeys": return "/hotkeys ";
    case "tree": return "/tree ";
    case "templates": return "/templates ";
    case "skills": return "/skills ";
    case "changelog": return "/changelog ";
    case "projects": return "/projects ";
    case "logout": return "/logout ";
  }
}

export function getActiveMenuPromptKind(app: AppState): MenuPromptKind | null {
  if (app.settingsPicker) return "settings";
  if (app.modelPicker) return "model";
  if (app.itemPicker?.kind) return app.itemPicker.kind;
  return null;
}

export function openMenuPrompt(app: AppState, kind: MenuPromptKind): void {
  app.input.setText(app.getMenuPromptPrefix(kind));
}

export function getMenuFilterQuery(app: AppState): string {
  const kind = app.getActiveMenuPromptKind();
  if (!kind) return "";
  const prefix = app.getMenuPromptPrefix(kind);
  const text = app.input.getText();
  return text.startsWith(prefix) ? text.slice(prefix.length).trimStart() : "";
}

export function handleMenuPromptKey(app: AppState, key: Keypress): boolean {
  const kind = app.getActiveMenuPromptKind();
  if (!kind) return false;
  const prefix = app.getMenuPromptPrefix(kind);
  const before = app.input.getText();
  const beforeQuery = before.startsWith(prefix) ? before.slice(prefix.length) : "";
  const beforeCursor = app.input.getCursor();
  const beforeQueryCursor = Math.max(0, beforeCursor - prefix.length);
  const editableKey = key.name === "backspace"
    || key.name === "delete"
    || key.name === "left"
    || key.name === "right"
    || key.name === "home"
    || key.name === "end"
    || (key.ctrl && (key.name === "a" || key.name === "e" || key.name === "u" || key.name === "w" || key.name === "h"))
    || (!!key.char && !key.ctrl && !key.meta && key.char.length === 1);
  if (!editableKey) return false;

  app.input.handleKey(key);
  let text = app.input.getText();
  if (!text.startsWith(prefix)) {
    text = prefix + beforeQuery;
    app.input.setText(text);
    app.input.setCursor(prefix.length + beforeQueryCursor);
    return true;
  }
  if (text.length < prefix.length) app.input.setText(prefix);
  if (app.input.getCursor() < prefix.length) app.input.setCursor(prefix.length);
  return true;
}

export function getSidebarMaxScroll(app: AppState, visibleHeight: number): number {
  const sidebarLines = app.buildSidebarLines();
  return Math.max(0, sidebarLines.length - visibleHeight);
}

export function clampMenuCursor(_app: AppState, cursor: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(itemCount - 1, cursor));
}

export function buildMenuView(_app: AppState, entries: MenuEntry[], cursor: number, maxVisible: number): MenuEntry[] {
  if (entries.length <= maxVisible) return entries;
  let cursorEntryIndex = entries.findIndex((entry) => entry.selectIndex === cursor);
  if (cursorEntryIndex < 0) cursorEntryIndex = entries.findIndex((entry) => entry.selectIndex !== undefined);
  if (cursorEntryIndex < 0) cursorEntryIndex = 0;
  let start = Math.max(0, cursorEntryIndex - Math.floor(maxVisible / 2));
  if (start + maxVisible > entries.length) start = Math.max(0, entries.length - maxVisible);
  return entries.slice(start, start + maxVisible);
}

export function registerMenuClickTarget(_app: AppState, targets: Array<{ lineIndex: number; action: () => void }>, lines: string[], action: () => void): void {
  targets.push({ lineIndex: lines.length, action });
}

export function getFilePickerEntries(app: AppState): MenuEntry[] {
  if (!app.filePicker) return [];
  return app.filePicker.filtered.map((file: string, i: number) => {
    const isCursor = i === app.filePicker.cursor;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const color = isCursor ? `${TXT()}${BOLD}` : DIM;
    return { text: ` ${arrow}${color}${file}${RESET}`, selectIndex: i };
  });
}

export function getSettingsPickerEntries(app: AppState): MenuEntry[] {
  if (!app.settingsPicker) return [];
  const filtered = app.getFilteredSettings();
  return filtered.map((entry: SettingEntry, i: number) => {
    const isCursor = i === app.settingsPicker.cursor;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const nameCol = isCursor ? `${TXT()}${BOLD}` : T();
    const pad = " ".repeat(Math.max(1, 22 - entry.label.length));
    const valColor = entry.value === "true" ? T() : DIM;
    return { text: ` ${arrow}${nameCol}${entry.label}${RESET}${pad}${valColor}${entry.value}${RESET}`, selectIndex: i };
  });
}

export function getItemPickerEntries(app: AppState): MenuEntry[] {
  if (!app.itemPicker) return [];
  const filtered = app.getFilteredItems();
  return filtered.map((item: PickerItem, i: number) => {
    const isCursor = i === app.itemPicker.cursor;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const labelCol = isCursor ? `${TXT()}${BOLD}` : T();
    return { text: ` ${arrow}${labelCol}${item.label}${RESET}${item.detail ? ` ${DIM}${item.detail}${RESET}` : ""}`, selectIndex: i };
  });
}

export function getModelPickerEntries(app: AppState): MenuEntry[] {
  if (!app.modelPicker) return [];
  const filtered = app.getFilteredModels();
  const byProvider = new Map<string, ModelOption[]>();
  for (const opt of filtered) {
    if (!byProvider.has(opt.providerName)) byProvider.set(opt.providerName, []);
    byProvider.get(opt.providerName)!.push(opt);
  }
  const entries: MenuEntry[] = [];
  let currentIdx = 0;
  for (const [provider, opts] of byProvider) {
    entries.push({ text: ` ${DIM}${provider}${RESET}` });
    for (const opt of opts) {
      const isCursor = currentIdx === app.modelPicker.cursor;
      const pin = opt.active ? ` ${T()}*${RESET}` : "";
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const nameCol = isCursor ? `${TXT()}${BOLD}` : T();
      const badges = opt.badges && opt.badges.length > 0
        ? ` ${DIM}${opt.badges.join(" · ")}${RESET}`
        : "";
      entries.push({ text: `  ${arrow}${nameCol}${opt.modelId}${RESET}${pin}${badges}`, selectIndex: currentIdx });
      currentIdx++;
    }
  }
  return entries;
}

export function getCommandSuggestionEntries(app: AppState): MenuEntry[] {
  const matches = app.getCommandMatches();
  if (matches.length === 0) return [];
  const cursor = Math.min(app.cmdSuggestionCursor, matches.length - 1);
  return matches.map((entry: any, i: number) => {
    const arrow = i === cursor ? `${T()}> ${RESET}` : "  ";
    const nameColor = i === cursor ? `${TXT()}${BOLD}` : T();
    const pad = " ".repeat(Math.max(1, 16 - entry.name.length));
    const detail = entry.hotkey ? `${entry.desc} (${entry.hotkey})` : entry.desc;
    return { text: ` ${arrow}${nameColor}${entry.name}${RESET}${pad}${DIM}${detail}${RESET}`, selectIndex: i };
  });
}

export function scrollSidebar(app: AppState, delta: number, visibleHeight: number): void {
  const maxScroll = app.getSidebarMaxScroll(visibleHeight);
  app.sidebarScrollOffset = Math.max(0, Math.min(maxScroll, app.sidebarScrollOffset + delta));
}

export function scrollActiveMenu(app: AppState, delta: number): boolean {
  if (app.settingsPicker) {
    app.settingsPicker.cursor = app.clampMenuCursor(app.settingsPicker.cursor + delta, app.getFilteredSettings().length);
    return true;
  }
  if (app.itemPicker) {
    app.itemPicker.cursor = app.clampMenuCursor(app.itemPicker.cursor + delta, app.getFilteredItems().length);
    app.previewCurrentItem();
    return true;
  }
  if (app.modelPicker) {
    app.modelPicker.cursor = app.clampMenuCursor(app.modelPicker.cursor + delta, app.getFilteredModels().length);
    return true;
  }
  if (app.filePicker) {
    app.filePicker.cursor = app.clampMenuCursor(app.filePicker.cursor + delta, app.filePicker.filtered.length);
    return true;
  }
  const suggestions = app.getCommandMatches();
  if (suggestions.length > 0) {
    app.cmdSuggestionCursor = app.clampMenuCursor(app.cmdSuggestionCursor + delta, suggestions.length);
    return true;
  }
  return false;
}

export function toggleSettingEntry(app: AppState, index: number): void {
  if (!app.settingsPicker) return;
  const filtered = app.getFilteredSettings();
  const entry = filtered[index];
  if (!entry) return;
  app.settingsPicker.cursor = index;
  if (app.onSettingToggle) app.onSettingToggle(entry.key);
  app.draw();
}

export function selectItemEntry(app: AppState, index: number): void {
  if (!app.itemPicker) return;
  const filtered = app.getFilteredItems();
  const item = filtered[index];
  if (!item) return;
  app.itemPicker.cursor = index;
  const closeOnSelect = app.itemPicker.closeOnSelect ?? true;
  if (app.onItemSelect) app.onItemSelect(item.id);
  if (closeOnSelect) app.closeItemPicker(false);
  else app.draw();
}

export function toggleModelPin(app: AppState, index: number): void {
  if (!app.modelPicker) return;
  const filtered = app.getFilteredModels();
  const opt = filtered[index];
  if (!opt) return;
  app.modelPicker.cursor = index;
  opt.active = !opt.active;
  if (app.onModelPin) app.onModelPin(opt.providerId, opt.modelId, opt.active);
  app.draw();
}

export function selectModelEntry(app: AppState, index: number): void {
  if (!app.modelPicker) return;
  const filtered = app.getFilteredModels();
  const selected = filtered[index];
  if (!selected) return;
  app.modelPicker.cursor = index;
  app.modelPicker = null;
  app.input.clear();
  if (app.onModelSelect) app.onModelSelect(selected.providerId, selected.modelId);
  app.drawNow();
}

export function selectTreeEntry(app: AppState): void {
  const selectedId = app.treeView?.selectedId;
  if (!selectedId || !app.onTreeSelect) return;
  void app.onTreeSelect(selectedId);
}

export function selectFileEntry(app: AppState, index: number): void {
  if (!app.filePicker) return;
  const selected = app.filePicker.filtered[index];
  if (!selected) return;
  app.filePicker.cursor = index;
  const text = app.input.getText();
  const atIdx = text.lastIndexOf("@");
  if (atIdx >= 0) {
    app.input.clear();
    app.input.paste(text.slice(0, atIdx) + `@${selected} `);
  }
  const content = readFileForContext(app.cwd, selected);
  app.fileContexts.set(selected, content);
  app.filePicker = null;
  app.drawNow();
}

export function applyCommandSuggestion(app: AppState, index: number, submitOnReturn = false): void {
  const suggestions = app.getCommandMatches();
  const selected = suggestions[index];
  if (!selected) return;
  app.cmdSuggestionCursor = index;
  app.input.clear();
  app.input.paste(`/${selected.name}`);
  if (submitOnReturn) {
    const cmd = app.input.submit();
    if (cmd && app.onSubmit) app.onSubmit(cmd);
  }
  app.draw();
}

export function hideCursorBriefly(app: AppState, durationMs = 140): void {
  app.hideCursorUntil = Date.now() + durationMs;
  if (app.hideCursorTimer) clearTimeout(app.hideCursorTimer);
  app.hideCursorTimer = setTimeout(() => {
    app.hideCursorTimer = null;
    app.draw();
  }, durationMs + 10);
}

export function getSidebarBorder(app: AppState): string {
  return `${currentTheme().sidebarBorder}│${RESET}`;
}

export function scrollTranscript(app: AppState, delta: number): boolean {
  const chatHeight = app.getChatHeight();
  const messageLines = app.renderMessages(app.screen.mainWidth - 2);
  const maxScroll = Math.max(0, messageLines.length - chatHeight);
  const next = Math.max(0, Math.min(maxScroll, app.scrollOffset + delta));
  if (next === app.scrollOffset) return false;
  app.scrollOffset = next;
  app.invalidateMsgCache();
  return true;
}

export function shouldEnableMenuMouse(app: AppState): boolean {
  void app;
  return false;
}
