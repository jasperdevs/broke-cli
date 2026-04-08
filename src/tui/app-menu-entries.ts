import { currentTheme } from "../core/themes.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { visibleWidth } from "../utils/terminal-width.js";
import stripAnsi from "strip-ansi";
import { ERR, MUTED, T, TXT } from "./app-shared.js";
import { wordWrap } from "./render/formatting.js";
import type { MenuEntry, ModelOption, PickerItem, SettingEntry } from "./app-types.js";

type AppState = any;

function lineCount(entry: MenuEntry): number {
  return Math.max(1, entry.lines.length);
}

function getMenuBodyWidth(app: AppState): number {
  return Math.max(18, app.screen.mainWidth - 6);
}

function buildSelectableEntry(prefix: string, primary: string, detail: string | undefined, width: number, detailColor = DIM): string[] {
  const plainPrimary = stripAnsi(primary);
  const plainDetail = detail?.trim() ?? "";
  if (!plainDetail) return [`${prefix}${primary}${RESET}`];
  const inlineSeparator = `${DIM} — ${RESET}`;
  const inline = `${prefix}${primary}${inlineSeparator}${detailColor}${plainDetail}${RESET}`;
  if (visibleWidth(inline) <= width + visibleWidth(prefix)) return [inline];
  const available = Math.max(12, width - plainPrimary.length - 3);
  let compactDetail = plainDetail;
  if (plainDetail.length > available) {
    const hotkeyMatch = plainDetail.match(/\((ctrl\+[a-z]|alt\+[↑↓]|shift\+[a-z]+)\)\s*$/i);
    const hotkeySuffix = hotkeyMatch?.[0] ?? "";
    const headBudget = Math.max(0, available - hotkeySuffix.length - 2);
    compactDetail = `${plainDetail.slice(0, headBudget)}…${hotkeySuffix}`;
  }
  return [`${prefix}${primary}${inlineSeparator}${detailColor}${compactDetail}${RESET}`];
}

function wrapMenuLabel(prefix: string, label: string, width: number): string[] {
  const wrapped = wordWrap(label, Math.max(10, width));
  return wrapped.map((line, index) => index === 0 ? `${prefix}${line}${RESET}` : `    ${line}${RESET}`);
}

export function buildMenuView(_app: AppState, entries: MenuEntry[], cursor: number, maxVisibleLines: number): MenuEntry[] {
  if (entries.length === 0) return entries;
  const totalLines = entries.reduce((sum, entry) => sum + lineCount(entry), 0);
  if (totalLines <= maxVisibleLines) return entries;
  let cursorEntryIndex = entries.findIndex((entry) => entry.selectIndex === cursor);
  if (cursorEntryIndex < 0) cursorEntryIndex = entries.findIndex((entry) => entry.selectIndex !== undefined);
  if (cursorEntryIndex < 0) cursorEntryIndex = 0;
  let start = cursorEntryIndex;
  let end = cursorEntryIndex + 1;
  let used = lineCount(entries[cursorEntryIndex]!);

  while (start > 0 || end < entries.length) {
    const canGrowUp = start > 0;
    const canGrowDown = end < entries.length;
    const nextUp = canGrowUp ? lineCount(entries[start - 1]!) : Number.POSITIVE_INFINITY;
    const nextDown = canGrowDown ? lineCount(entries[end]!) : Number.POSITIVE_INFINITY;
    const pickUp = canGrowUp && (!canGrowDown || nextUp <= nextDown);
    const nextCount = pickUp ? nextUp : nextDown;
    if (used + nextCount > maxVisibleLines) break;
    if (pickUp) {
      start--;
      used += nextUp;
    } else {
      used += nextDown;
      end++;
    }
  }

  return entries.slice(start, end);
}

export function registerMenuClickTarget(_app: AppState, targets: Array<{ lineIndex: number; action: () => void }>, lines: string[], action: () => void): void {
  targets.push({ lineIndex: lines.length, action });
}

export function getFilePickerEntries(app: AppState): MenuEntry[] {
  if (!app.filePicker) return [];
  const width = getMenuBodyWidth(app);
  return app.filePicker.filtered.map((file: string, i: number) => {
    const isCursor = i === app.filePicker.cursor;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const color = isCursor ? `${TXT()}${BOLD}` : DIM;
    return { lines: wrapMenuLabel(` ${arrow}${color}`, file, width), selectIndex: i };
  });
}

export function getSettingsPickerEntries(app: AppState): MenuEntry[] {
  if (!app.settingsPicker) return [];
  const width = getMenuBodyWidth(app);
  const filtered = app.getFilteredSettings();
  return filtered.map((entry: SettingEntry, i: number) => {
    const isCursor = i === app.settingsPicker.cursor;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const nameCol = isCursor ? `${TXT()}${BOLD}` : T();
    const valColor = entry.value === "true" ? T() : DIM;
    return {
      lines: buildSelectableEntry(
        ` ${arrow}${nameCol}`,
        `${entry.label}${DIM} · ${valColor}${entry.value}`,
        entry.description,
        width,
      ),
      selectIndex: i,
    };
  });
}

export function getItemPickerEntries(app: AppState): MenuEntry[] {
  if (!app.itemPicker) return [];
  const width = getMenuBodyWidth(app);
  const filtered = app.getFilteredItems();
  return filtered.map((item: PickerItem, i: number) => {
    const isCursor = i === app.itemPicker.cursor;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const labelCol = item.tone === "danger"
      ? ERR()
      : isCursor ? `${TXT()}${BOLD}` : T();
    return {
      lines: buildSelectableEntry(` ${arrow}${labelCol}`, item.label, item.detail, width, item.tone === "danger" ? ERR() : MUTED()),
      selectIndex: i,
    };
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
  const width = getMenuBodyWidth(app);
  entries.push({ lines: [` ${DIM}enter choose use · space favorite · type filter${RESET}`] });
  for (const [provider, opts] of byProvider) {
    if (showProviderHeaders) entries.push({ lines: [` ${DIM}${provider}${RESET}`] });
    for (const opt of opts) {
      const isCursor = currentIdx === app.modelPicker.cursor;
      const pin = opt.active ? ` ${T()}*${RESET}` : "";
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const nameCol = isCursor ? `${TXT()}${BOLD}` : T();
      const badges = opt.badges && opt.badges.length > 0
        ? opt.badges.map((badge) => badgeLabels[badge] ?? badge).join(" · ")
        : undefined;
      entries.push({
        lines: buildSelectableEntry(
          `  ${arrow}${nameCol}`,
          `${opt.displayName ?? opt.modelId}${pin}`,
          badges,
          width,
        ),
        selectIndex: currentIdx,
      });
      currentIdx++;
    }
  }
  return entries;
}

export function getCommandSuggestionEntries(app: AppState): MenuEntry[] {
  const matches = app.getCommandMatches();
  if (matches.length === 0) return [];
  const cursor = Math.min(app.cmdSuggestionCursor, matches.length - 1);
  const width = getMenuBodyWidth(app);
  return matches.map((entry: any, i: number) => {
    const arrow = i === cursor ? `${T()}> ${RESET}` : "  ";
    const nameColor = i === cursor ? `${TXT()}${BOLD}` : T();
    const detail = entry.hotkey ? `${entry.desc} (${entry.hotkey})` : entry.desc;
    return {
      lines: buildSelectableEntry(` ${arrow}${nameColor}`, entry.name, detail, width),
      selectIndex: i,
    };
  });
}

export function getSidebarBorderLine(): string {
  return `${currentTheme().sidebarBorder}│${RESET}`;
}
