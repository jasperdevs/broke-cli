import { getSettings } from "../core/config.js";
import { currentTheme } from "../core/themes.js";
import { filterFiles, readFileForContext } from "./file-picker.js";
import { insertInlineFileChip } from "./inline-chip-utils.js";
import type { Keypress } from "./keypress.js";
import { BOLD, RESET } from "../utils/ansi.js";
import { DIM } from "../utils/ansi.js";
import { visibleWidth } from "../utils/terminal-width.js";
import { TXT } from "./app-shared.js";
import { wordWrap } from "./render/formatting.js";
import type { MenuPromptKind, ModelOption, PickerItem, SettingEntry } from "./app-types.js";
import { moveTreeSelection } from "./tree-view.js";
import { buildFooterLines, getPendingFilePromptLines, getPendingImagePromptLines, getPendingMessagePromptLines } from "./bottom-ui.js";
import { getQuestionMenuLineCount, scrollQuestionMenu } from "./question-menu.js";
import { getModelLanePickerEntries, openModelLanePicker, selectModelLaneEntry } from "./model-lane-picker.js";
import {
  buildMenuView,
  getActiveMenuDetail,
  getCommandSuggestionEntries,
  getFilePickerEntries,
  getItemPickerEntries,
  getModelPickerEntries,
  getSettingsPickerEntries,
  getSidebarBorderLine,
  registerMenuClickTarget,
} from "./app-menu-entries.js";
type AppState = any;

function styleComposerLine(app: AppState, line: string): string {
  let styled = line;
  const elements = app.input.getElements?.() ?? [];
  for (const element of elements) {
    if (element.kind !== "image" && element.kind !== "skill") continue;
    const styledLabel = element.kind === "image"
      ? `${currentTheme().imageTagBg}${BOLD}${TXT()}${element.label}${RESET}`
      : `\x1b[38;2;80;170;255m${element.label}${RESET}`;
    styled = styled.split(element.label).join(styledLabel);
  }
  return styled;
}

function getComposerSourceLines(app: AppState, text: string): string[] {
  void app;
  return `${text || ""}`.split("\n");
}

function wrapComposerLines(app: AppState, text: string, width: number, styled: boolean): string[] {
  const padX = Math.max(0, getSettings().editorPaddingX | 0);
  const usableWidth = Math.max(1, width - 2 - (padX * 2));
  const wrapped: string[] = [];
  for (const line of getComposerSourceLines(app, text)) {
    const lineParts = line.length === 0 ? [""] : wordWrap(line, usableWidth);
    for (const part of lineParts) {
      const plainLine = `${" ".repeat(padX)}${part}`;
      wrapped.push(styled ? styleComposerLine(app, plainLine) : plainLine);
    }
  }
  return wrapped.length > 0 ? wrapped : [" ".repeat(padX)];
}

function getComposerMaxVisibleRows(app: AppState, maxHeight = app.screen.height): number {
  return Math.max(3, Math.floor(Math.max(1, maxHeight) * 0.6));
}

function getMenuVisibleRows(maxHeight: number, baseCount: number, tailReserve: number, chromeLines: number): number {
  return Math.max(1, maxHeight - baseCount - tailReserve - 1 - chromeLines);
}

function hasActiveBottomMenuDetail(app: AppState): boolean {
  return !!(app.itemPicker || app.settingsPicker || app.modelPicker) && !!getActiveMenuDetail(app);
}

function getVisibleMenuLineCount(app: AppState, entries: Array<{ lines: string[] }>, cursor: number, maxHeight: number, baseCount: number, tailReserve: number, chromeLines: number): number {
  const visible = app.buildMenuView(entries, cursor, getMenuVisibleRows(maxHeight, baseCount, tailReserve, chromeLines));
  return Math.max(1, visible.reduce((sum: number, entry: { lines: string[] }) => sum + Math.max(1, entry.lines.length), 0));
}
export function scrollToBottom(app: AppState): void {
  const chatHeight = app.getChatHeight();
  const messageLines = app.renderMessages(app.getTranscriptRenderWidth());
  app.scrollOffset = Math.max(0, messageLines.length - chatHeight);
  app.transcriptAutoFollow = true;
}
export function getChatHeight(app: AppState): number {
  const hasSidebar = app.shouldShowSidebar();
  const headerLines = !hasSidebar && app.messages.length > 0 && app.modelName !== "none" ? 1 : 0;
  const mainW = hasSidebar ? app.screen.mainWidth : app.screen.width;
  const bottomBase = app.getBottomLineCount(mainW, app.screen.height);
  return Math.max(1, app.screen.height - bottomBase - headerLines);
}
export function getSidebarViewportHeight(app: AppState): number {
  if (!app.shouldShowSidebar()) return app.screen.height;
  return Math.max(1, app.screen.height - app.renderSidebarFooter().length);
}

export function getBottomLineCount(app: AppState, mainW: number, maxHeight: number): number {
  const maxVisibleRows = Math.max(1, getSettings().autocompleteMaxVisible);
  const btwBubbleLineCount = app.renderBtwBubble(mainW).length;
  const pendingMessageLineCount = getPendingMessagePromptLines(app, mainW).length;
  const inputLayout = app.getInputCursorLayout(app.input.getText(), app.input.getCursor(), mainW);
  const totalInputLines = app.getWrappedInputLines(app.input.getText(), mainW).length;
  const inputLineCount = inputLayout.lines.length + (totalInputLines > inputLayout.lines.length ? 1 : 0);
  const statusLineCount = app.statusMessage ? 2 : 0;
  const footerLineCount = buildFooterLines(app, app.shouldShowSidebar(), mainW).length;
  const detailLineCount = hasActiveBottomMenuDetail(app) ? 1 : 0;
  const tailReserve = 2;
  let count = 2 + footerLineCount + inputLineCount + statusLineCount;
  if (btwBubbleLineCount > 0) count += btwBubbleLineCount + 1;
  if (pendingMessageLineCount > 0) count += pendingMessageLineCount + 1;
  const baseCount = count;

  if (app.filePicker) {
    const entries = app.getFilePickerEntries();
    const visible = entries.length === 0 ? 1 : getVisibleMenuLineCount(app, entries, app.filePicker.cursor, maxHeight, baseCount, tailReserve, 1);
    count += 2 + visible;
  } else if (app.itemPicker) {
    const entries = app.getItemPickerEntries();
    const visible = entries.length === 0 ? 1 : getVisibleMenuLineCount(app, entries, app.itemPicker.cursor, maxHeight, baseCount, tailReserve, 1);
    count += 2 + visible + detailLineCount;
  } else if (app.settingsPicker) {
    const entries = app.getSettingsPickerEntries();
    const visible = entries.length === 0 ? 1 : getVisibleMenuLineCount(app, entries, app.settingsPicker.cursor, maxHeight, baseCount, tailReserve, 1);
    count += 2 + visible + detailLineCount;
  } else if (app.modelPicker) {
    const entries = app.getModelPickerEntries();
    const visible = entries.length === 0 ? 1 : getVisibleMenuLineCount(app, entries, app.modelPicker.cursor, maxHeight, baseCount, tailReserve, 2);
    count += 3 + visible + detailLineCount;
  } else if (app.treeView) {
    const rows = app.getVisibleTreeRows();
    const entries = app.getTreePickerEntries();
    const selectedIndex = Math.max(0, rows.findIndex((row: any) => row.item.id === app.treeView?.selectedId));
    const visible = rows.length === 0 ? 1 : getVisibleMenuLineCount(app, entries, selectedIndex, maxHeight, baseCount, tailReserve, 2);
    count += 3 + visible;
  } else if (app.questionView) {
    count += getQuestionMenuLineCount(app, maxVisibleRows, getMenuVisibleRows(maxHeight, baseCount, tailReserve, 2));
  } else {
    const allSuggestions = app.getCommandSuggestionEntries();
    if (allSuggestions.length > 0) {
      const visible = getVisibleMenuLineCount(app, allSuggestions, app.cmdSuggestionCursor, maxHeight, baseCount, tailReserve, 1);
      count += 2 + visible;
    }
  }

  count += tailReserve;
  return count;
}
export function getWrappedInputLines(app: AppState, text: string, width: number): string[] {
  return wrapComposerLines(app, text, width, true);
}

export function getInputCursorLayout(app: AppState, text: string, cursor: number, width: number): { lines: string[]; row: number; col: number } {
  const lines = app.getWrappedInputLines(text, width);
  const cursorLines = wrapComposerLines(app, text.slice(0, cursor), width, false);
  const currentLine = cursorLines[cursorLines.length - 1] ?? "";
  const absoluteRow = Math.max(0, cursorLines.length - 1);
  const maxVisibleRows = Math.max(1, Math.min(lines.length, getComposerMaxVisibleRows(app)));
  const maxScroll = Math.max(0, lines.length - maxVisibleRows);
  if (app.composerScrollOffset > maxScroll) app.composerScrollOffset = maxScroll;
  if (absoluteRow < app.composerScrollOffset) app.composerScrollOffset = absoluteRow;
  if (absoluteRow >= app.composerScrollOffset + maxVisibleRows) {
    app.composerScrollOffset = absoluteRow - maxVisibleRows + 1;
  }
  const viewportStart = Math.max(0, Math.min(maxScroll, app.composerScrollOffset));
  return {
    lines: lines.slice(viewportStart, viewportStart + maxVisibleRows),
    row: Math.max(0, absoluteRow - viewportStart),
    col: visibleWidth(currentLine),
  };
}
export function getFilteredModels(app: AppState): ModelOption[] {
  if (!app.modelPicker) return [];
  const q = app.getMenuFilterQuery().toLowerCase();
  const pool = app.modelPicker.options;
  if (!q) return pool;
  return pool.filter((o: ModelOption) =>
    o.modelId.toLowerCase().includes(q)
    || o.providerName.toLowerCase().includes(q)
    || (o.displayName ?? "").toLowerCase().includes(q),
  );
}

export function toggleModelScope(app: AppState): void { void app; }

export function getFilteredSettings(app: AppState): SettingEntry[] {
  if (!app.settingsPicker) return [];
  const q = app.getMenuFilterQuery().toLowerCase();
  if (!q) return app.settingsPicker.entries;
  return app.settingsPicker.entries.filter((e: SettingEntry) => e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
}

export function getFilteredItems(app: AppState): PickerItem[] {
  if (!app.itemPicker) return [];
  const inlineSkill = app.itemPicker.inlineSkill;
  const q = (inlineSkill
    ? app.input.getText().slice(inlineSkill.nameStart, app.input.getCursor())
    : app.getMenuFilterQuery()).toLowerCase();
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
    case "name": return "/name ";
    case "login": return "/login ";
    case "connect": return "/connect ";
    case "settings": return "/settings ";
    case "extensions": return "/extensions ";
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
  return "/";
}

export function getActiveMenuPromptKind(app: AppState): MenuPromptKind | null {
  if (app.modelLanePicker) return "model";
  if (app.settingsPicker) return "settings";
  if (app.modelPicker) return "model";
  if (app.treeView) return "tree";
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

export function scrollSidebar(app: AppState, delta: number, visibleHeight: number): void {
  const maxScroll = app.getSidebarMaxScroll(visibleHeight);
  app.sidebarScrollOffset = Math.max(0, Math.min(maxScroll, app.sidebarScrollOffset + delta));
}

export function scrollActiveMenu(app: AppState, delta: number): boolean {
  if (app.modelLanePicker) {
    app.modelLanePicker.cursor = app.clampMenuCursor(app.modelLanePicker.cursor + delta, app.modelLanePicker.options.length);
    return true;
  }
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
  if (app.treeView) {
    moveTreeSelection(app, delta);
    return true;
  }
  if (app.questionView) {
    return scrollQuestionMenu(app, delta);
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
  const onSelect = app.onTreeSelect;
  app.closeTreeView();
  void onSelect(selectedId);
}

export function selectFileEntry(app: AppState, index: number): void {
  if (!app.filePicker) return;
  const selected = app.filePicker.filtered[index];
  if (!selected) return;
  app.filePicker.cursor = index;
  const text = app.input.getText();
  const cursor = app.input.getCursor();
  const atIdx = text.lastIndexOf("@", Math.max(0, cursor - 1));
  const replaceStart = atIdx >= 0 ? atIdx : cursor;
  const replaceEnd = cursor;
  insertInlineFileChip(app, selected, replaceStart, replaceEnd);
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
  app.hideCursorUntil = 0;
  if (app.hideCursorTimer) {
    clearTimeout(app.hideCursorTimer);
    app.hideCursorTimer = null;
  }
  void durationMs;
}

export function getTranscriptRenderWidth(app: AppState): number {
  return app.shouldShowSidebar() ? app.screen.mainWidth : app.screen.width;
}

export function getSidebarBorder(app: AppState): string {
  void app;
  return getSidebarBorderLine();
}

export function scrollTranscript(app: AppState, delta: number): boolean {
  const chatHeight = app.getChatHeight();
  const messageLines = app.renderMessages(app.getTranscriptRenderWidth());
  const maxScroll = Math.max(0, messageLines.length - chatHeight);
  const next = Math.max(0, Math.min(maxScroll, app.scrollOffset + delta));
  if (next === app.scrollOffset) return false;
  app.scrollOffset = next;
  app.transcriptAutoFollow = next >= maxScroll;
  app.invalidateMsgCache();
  return true;
}

export function shouldEnableMenuMouse(app: AppState): boolean {
  return !!(
    app.filePicker
    || app.itemPicker
    || app.settingsPicker
    || app.modelPicker
    || app.treeView
    || app.budgetView
    || app.questionView
  );
}
