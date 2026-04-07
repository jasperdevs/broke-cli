import {
  buildMenuView,
  clampMenuCursor,
  closeItemPicker,
  getActiveMenuPromptKind,
  getBottomLineCount,
  getChatHeight,
  getCommandSuggestionEntries,
  getFilePickerEntries,
  getFilteredItems,
  getFilteredModels,
  getFilteredSettings,
  getInputCursorLayout,
  getItemPickerEntries,
  getMenuFilterQuery,
  getMenuPromptPrefix,
  getModelPickerEntries,
  getSettingsPickerEntries,
  getSidebarBorder,
  getSidebarMaxScroll,
  getWrappedInputLines,
  handleMenuPromptKey,
  hideCursorBriefly,
  openMenuPrompt,
  previewCurrentItem,
  registerMenuClickTarget,
  scrollActiveMenu,
  scrollSidebar,
  scrollToBottom,
  scrollTranscript,
  selectFileEntry,
  selectItemEntry,
  selectModelEntry,
  selectTreeEntry,
  shouldEnableMenuMouse,
  toggleModelPin,
  toggleModelScope,
  toggleSettingEntry,
  applyCommandSuggestion,
} from "./app-menu-methods.js";
import type { Keypress } from "./keypress.js";
import type { MenuEntry, MenuPromptKind, ModelOption, PickerItem, SettingEntry } from "./app-types.js";

type AppState = any;

export interface AppMenuMethods {
  scrollToBottom(): void;
  getChatHeight(): number;
  getBottomLineCount(mainW: number, maxHeight: number): number;
  getWrappedInputLines(text: string, width: number): string[];
  getInputCursorLayout(text: string, cursor: number, width: number): { lines: string[]; row: number; col: number };
  getFilteredModels(): ModelOption[];
  toggleModelScope(): void;
  getFilteredSettings(): SettingEntry[];
  getFilteredItems(): PickerItem[];
  previewCurrentItem(): void;
  closeItemPicker(revertPreview?: boolean): void;
  getMenuPromptPrefix(kind: MenuPromptKind): string;
  getActiveMenuPromptKind(): MenuPromptKind | null;
  openMenuPrompt(kind: MenuPromptKind): void;
  getMenuFilterQuery(): string;
  handleMenuPromptKey(key: Keypress): boolean;
  getSidebarMaxScroll(visibleHeight: number): number;
  clampMenuCursor(cursor: number, itemCount: number): number;
  buildMenuView(entries: MenuEntry[], cursor: number, maxVisible: number): MenuEntry[];
  registerMenuClickTarget(targets: Array<{ lineIndex: number; action: () => void }>, lines: string[], action: () => void): void;
  getFilePickerEntries(): MenuEntry[];
  getSettingsPickerEntries(): MenuEntry[];
  getItemPickerEntries(): MenuEntry[];
  getModelPickerEntries(): MenuEntry[];
  getCommandSuggestionEntries(): MenuEntry[];
  scrollSidebar(delta: number, visibleHeight: number): void;
  scrollActiveMenu(delta: number): boolean;
  toggleSettingEntry(index: number): void;
  selectItemEntry(index: number): void;
  toggleModelPin(index: number): void;
  selectModelEntry(index: number): void;
  selectTreeEntry(): void;
  selectFileEntry(index: number): void;
  applyCommandSuggestion(index: number, submitOnReturn?: boolean): void;
  hideCursorBriefly(durationMs?: number): void;
  getSidebarBorder(): string;
  scrollTranscript(delta: number): boolean;
  shouldEnableMenuMouse(): boolean;
}

export const appMenuMethods: AppMenuMethods = {
  scrollToBottom(this: AppState) { return scrollToBottom(this); },
  getChatHeight(this: AppState) { return getChatHeight(this); },
  getBottomLineCount(this: AppState, mainW: number, maxHeight: number) { return getBottomLineCount(this, mainW, maxHeight); },
  getWrappedInputLines(this: AppState, text: string, width: number) { return getWrappedInputLines(this, text, width); },
  getInputCursorLayout(this: AppState, text: string, cursor: number, width: number) { return getInputCursorLayout(this, text, cursor, width); },
  getFilteredModels(this: AppState) { return getFilteredModels(this); },
  toggleModelScope(this: AppState) { return toggleModelScope(this); },
  getFilteredSettings(this: AppState) { return getFilteredSettings(this); },
  getFilteredItems(this: AppState) { return getFilteredItems(this); },
  previewCurrentItem(this: AppState) { return previewCurrentItem(this); },
  closeItemPicker(this: AppState, revertPreview?: boolean) { return closeItemPicker(this, revertPreview); },
  getMenuPromptPrefix(this: AppState, kind: MenuPromptKind) { return getMenuPromptPrefix(this, kind); },
  getActiveMenuPromptKind(this: AppState) { return getActiveMenuPromptKind(this); },
  openMenuPrompt(this: AppState, kind: MenuPromptKind) { return openMenuPrompt(this, kind); },
  getMenuFilterQuery(this: AppState) { return getMenuFilterQuery(this); },
  handleMenuPromptKey(this: AppState, key: Keypress) { return handleMenuPromptKey(this, key); },
  getSidebarMaxScroll(this: AppState, visibleHeight: number) { return getSidebarMaxScroll(this, visibleHeight); },
  clampMenuCursor(this: AppState, cursor: number, itemCount: number) { return clampMenuCursor(this, cursor, itemCount); },
  buildMenuView(this: AppState, entries: MenuEntry[], cursor: number, maxVisible: number) { return buildMenuView(this, entries, cursor, maxVisible); },
  registerMenuClickTarget(this: AppState, targets: Array<{ lineIndex: number; action: () => void }>, lines: string[], action: () => void) { return registerMenuClickTarget(this, targets, lines, action); },
  getFilePickerEntries(this: AppState) { return getFilePickerEntries(this); },
  getSettingsPickerEntries(this: AppState) { return getSettingsPickerEntries(this); },
  getItemPickerEntries(this: AppState) { return getItemPickerEntries(this); },
  getModelPickerEntries(this: AppState) { return getModelPickerEntries(this); },
  getCommandSuggestionEntries(this: AppState) { return getCommandSuggestionEntries(this); },
  scrollSidebar(this: AppState, delta: number, visibleHeight: number) { return scrollSidebar(this, delta, visibleHeight); },
  scrollActiveMenu(this: AppState, delta: number) { return scrollActiveMenu(this, delta); },
  toggleSettingEntry(this: AppState, index: number) { return toggleSettingEntry(this, index); },
  selectItemEntry(this: AppState, index: number) { return selectItemEntry(this, index); },
  toggleModelPin(this: AppState, index: number) { return toggleModelPin(this, index); },
  selectModelEntry(this: AppState, index: number) { return selectModelEntry(this, index); },
  selectTreeEntry(this: AppState) { return selectTreeEntry(this); },
  selectFileEntry(this: AppState, index: number) { return selectFileEntry(this, index); },
  applyCommandSuggestion(this: AppState, index: number, submitOnReturn?: boolean) { return applyCommandSuggestion(this, index, submitOnReturn); },
  hideCursorBriefly(this: AppState, durationMs?: number) { return hideCursorBriefly(this, durationMs); },
  getSidebarBorder(this: AppState) { return getSidebarBorder(this); },
  scrollTranscript(this: AppState, delta: number) { return scrollTranscript(this, delta); },
  shouldEnableMenuMouse(this: AppState) { return shouldEnableMenuMouse(this); },
};
