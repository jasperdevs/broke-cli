import { currentTheme } from "../core/themes.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { T, TXT } from "./app-shared.js";
import type { MenuEntry, ModelOption, PickerItem, SettingEntry } from "./app-types.js";

type AppState = any;

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
  const badgeLabels: Record<string, string> = {
    now: "current",
    default: "chat",
    small: "fast",
    btw: "btw",
    review: "review",
    plan: "planning",
    ui: "design/UI",
    arch: "architecture",
  };
  const filtered = app.getFilteredModels();
  const byProvider = new Map<string, ModelOption[]>();
  for (const opt of filtered) {
    if (!byProvider.has(opt.providerName)) byProvider.set(opt.providerName, []);
    byProvider.get(opt.providerName)!.push(opt);
  }
  const entries: MenuEntry[] = [];
  let currentIdx = 0;
  const showProviderHeaders = byProvider.size > 1;
  entries.push({ text: ` ${DIM}enter choose use · space favorite · type filter${RESET}` });
  for (const [provider, opts] of byProvider) {
    if (showProviderHeaders) entries.push({ text: ` ${DIM}${provider}${RESET}` });
    for (const opt of opts) {
      const isCursor = currentIdx === app.modelPicker.cursor;
      const pin = opt.active ? ` ${T()}*${RESET}` : "";
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const nameCol = isCursor ? `${TXT()}${BOLD}` : T();
      const badges = opt.badges && opt.badges.length > 0
        ? ` ${DIM}${opt.badges.map((badge) => badgeLabels[badge] ?? badge).join(" · ")}${RESET}`
        : "";
      entries.push({ text: `  ${arrow}${nameCol}${opt.displayName ?? opt.modelId}${RESET}${pin}${badges}`, selectIndex: currentIdx });
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

export function getSidebarBorderLine(): string {
  return `${currentTheme().sidebarBorder}│${RESET}`;
}
