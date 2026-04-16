import { currentTheme } from "../core/themes.js";
import { getModelSpec } from "../ai/model-catalog.js";
import { getLocalModelMetadata } from "../ai/local-model-metadata.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { truncateVisible, visibleWidth } from "../utils/terminal-width.js";
import { ERR, MUTED, T, TXT } from "./app-shared.js";
import { wordWrap } from "./render/formatting.js";
import type { MenuEntry, ModelOption, PickerItem, SettingEntry } from "./app-types.js";
import type { CommandEntry } from "./command-surface.js";

type AppState = any;

function lineCount(entry: MenuEntry): number {
  return Math.max(1, entry.lines.length);
}

function getMenuBodyWidth(app: AppState): number {
  return Math.max(18, app.screen.mainWidth - 6);
}

function buildSelectableEntry(prefix: string, primary: string, width: number): string[] {
  if (visibleWidth(`${prefix}${primary}`) <= width + visibleWidth(prefix)) return [`${prefix}${primary}${RESET}`];
  const truncated = truncateVisible(primary, Math.max(10, width - visibleWidth(prefix)));
  return [`${prefix}${truncated}${RESET}`];
}

export function getActiveMenuDetail(app: AppState): string | null {
  if (app.modelLanePicker) {
    const option = app.modelLanePicker.options[app.modelLanePicker.cursor];
    return option?.detail?.trim() || null;
  }
  if (app.settingsPicker) {
    const entry = app.getFilteredSettings()[app.settingsPicker.cursor];
    return entry?.description?.trim() || null;
  }
  if (app.itemPicker) {
    const item = app.getFilteredItems()[app.itemPicker.cursor];
    return item?.detail?.trim() || null;
  }
  if (app.modelPicker) {
    const opt = app.getFilteredModels()[app.modelPicker.cursor];
    if (!opt) return null;
    if (opt.providerId === "__auto__") {
      return "Scores by provider pricing first, then token and context efficiency.";
    }
    const localMeta = getLocalModelMetadata(opt.providerId, opt.modelId);
    const spec = getModelSpec(opt.modelId, opt.providerId);
    if (localMeta || spec) {
      const details = [
        spec?.providerId ? opt.providerName : null,
        localMeta?.architecture ?? null,
        localMeta?.parameterSize ?? null,
        localMeta?.quantization ?? null,
        spec?.limit.context ? `ctx ${Math.round(spec.limit.context / 1000)}k` : null,
        (localMeta?.toolCall ?? spec?.toolCall) === true ? "tools" : null,
        (localMeta?.reasoning ?? spec?.reasoning) === true ? "reasoning" : null,
      ].filter(Boolean);
      if (details.length > 0) return details.join(" · ");
    }
    const badges = opt.badges && opt.badges.length > 0 ? opt.badges.join(" · ") : "";
    return badges || opt.providerName || null;
  }
  const matches = app.getCommandMatches?.() ?? [];
  if (matches.length > 0) {
    const entry = matches[Math.min(app.cmdSuggestionCursor, matches.length - 1)];
    if (!entry) return null;
    return entry.hotkey ? `${entry.hotkey} · ${entry.desc}` : entry.desc || null;
  }
  return null;
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

  while (used > maxVisibleLines && end - start > 1) {
    const linesAbove = cursorEntryIndex - start;
    const linesBelow = end - cursorEntryIndex - 1;
    if (linesBelow > linesAbove && end - 1 > cursorEntryIndex) {
      end--;
      used -= lineCount(entries[end]!);
      continue;
    }
    if (start < cursorEntryIndex) {
      used -= lineCount(entries[start]!);
      start++;
      continue;
    }
    if (end - 1 > cursorEntryIndex) {
      end--;
      used -= lineCount(entries[end]!);
      continue;
    }
    break;
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
      lines: buildSelectableEntry(` ${arrow}${labelCol}`, item.label, width),
      selectIndex: i,
    };
  });
}

export function getModelPickerEntries(app: AppState): MenuEntry[] {
  if (!app.modelPicker) return [];
  const filtered = app.getFilteredModels();
  const autoOptions = filtered.filter((opt: ModelOption) => opt.providerId === "__auto__");
  const byProvider = new Map<string, ModelOption[]>();
  for (const opt of filtered) {
    if (opt.providerId === "__auto__") continue;
    if (!byProvider.has(opt.providerName)) byProvider.set(opt.providerName, []);
    byProvider.get(opt.providerName)!.push(opt);
  }
  const entries: MenuEntry[] = [];
  let currentIdx = 0;
  const showProviderHeaders = byProvider.size > 1;
  const width = getMenuBodyWidth(app);
  for (const opt of autoOptions) {
    const isCursor = currentIdx === app.modelPicker.cursor;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const nameCol = isCursor ? `\x1b[38;2;250;214;91m${BOLD}` : "\x1b[38;2;250;214;91m";
    entries.push({
      lines: buildSelectableEntry(
        `  ${arrow}${nameCol}`,
        `${opt.displayName ?? opt.modelId}`,
        width,
      ),
      selectIndex: currentIdx,
    });
    currentIdx++;
  }
  if (autoOptions.length > 0 && byProvider.size > 0) entries.push({ lines: [""] });
  for (const [provider, opts] of byProvider) {
    if (showProviderHeaders) entries.push({ lines: [` ${DIM}${provider}${RESET}`] });
    for (const opt of opts) {
      const isCursor = currentIdx === app.modelPicker.cursor;
      const pin = opt.active ? ` ${T()}*${RESET}` : "";
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const nameCol = isCursor ? `${TXT()}${BOLD}` : T();
      entries.push({
        lines: buildSelectableEntry(
          `  ${arrow}${nameCol}`,
          `${opt.displayName ?? opt.modelId}${pin}`,
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
  return matches.map((entry: CommandEntry, i: number) => {
    const arrow = i === cursor ? `${T()}> ${RESET}` : "  ";
    const nameColor = i === cursor ? `${TXT()}${BOLD}` : T();
    return {
      lines: buildSelectableEntry(` ${arrow}${nameColor}`, `/${entry.name}`, width),
      selectIndex: i,
    };
  });
}

export function getSidebarBorderLine(): string {
  return `${currentTheme().sidebarBorder}│${RESET}`;
}
