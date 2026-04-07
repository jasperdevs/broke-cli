import { currentTheme } from "../core/themes.js";
import { getSettings } from "../core/config.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { fmtCost } from "./render/formatting.js";
import { ERR, P, T, TXT, WARN } from "./app-shared.js";
import { visibleWidth } from "../utils/terminal-width.js";

type AppState = any;

function renderMenuCount(current: number, total: number): string {
  return `${DIM}(${current}/${total})${RESET}`;
}

export function getPendingImagePromptLines(app: AppState, mainW: number): string[] {
  if (!getSettings().terminal.showImages || !app.pendingImages || app.pendingImages.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < app.pendingImages.length; i++) {
    const tag = `${currentTheme().imageTagBg}${BOLD}${TXT()}[Image #${i + 1}]${RESET}`;
    const candidate = current ? `${current} ${tag}` : ` ${tag}`;
    if (current && visibleWidth(candidate) > mainW) {
      lines.push(current);
      current = ` ${tag}`;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function appendBottomMenus(
  app: AppState,
  bottomLines: string[],
  bottomMenuClicks: Array<{ lineIndex: number; action: () => void }>,
  height: number,
  mainW: number,
  separatorColor: string,
): void {
  const tailReserve = 2 + (app.statusMessage ? 1 : 0);
  const getAvailableBodyRows = (chromeLines: number): number =>
    Math.max(1, height - bottomLines.length - tailReserve - 1 - chromeLines);

  if (app.filePicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendFilePicker(bottomLines, getAvailableBodyRows(1), bottomMenuClicks);
    return;
  }
  if (app.itemPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendItemPicker(bottomLines, getAvailableBodyRows(1), bottomMenuClicks);
    return;
  }
  if (app.settingsPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendSettingsPicker(bottomLines, getAvailableBodyRows(1), bottomMenuClicks);
    return;
  }
  if (app.modelPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendModelPicker(bottomLines, getAvailableBodyRows(3), bottomMenuClicks);
    return;
  }
  if (app.treeView) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendTreePicker(bottomLines, getAvailableBodyRows(2), bottomMenuClicks);
    return;
  }

  const allSuggestions = app.getCommandSuggestionEntries();
  const maxVisible = Math.max(1, Math.min(getSettings().autocompleteMaxVisible, getAvailableBodyRows(1)));
  const suggestions = app.buildMenuView(allSuggestions, app.cmdSuggestionCursor, maxVisible);
  if (suggestions.length > 0) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    bottomLines.push(` ${T()}${BOLD}Commands${RESET} ${renderMenuCount(Math.min(app.cmdSuggestionCursor, allSuggestions.length - 1) + 1, allSuggestions.length)}`);
  }
  for (const entry of suggestions) {
    if (entry.selectIndex !== undefined) {
      app.registerMenuClickTarget(bottomMenuClicks, bottomLines, () => app.applyCommandSuggestion(entry.selectIndex!));
    }
    bottomLines.push(entry.text);
  }
}

export function buildInfoBar(app: AppState, hasSidebar: boolean, mainW: number): string {
  const parts: Array<{ text: string; plain: string }> = [];
  if (app.ctrlCCount === 1) parts.push({ text: `${ERR()}Ctrl+C again to exit${RESET}`, plain: "Ctrl+C again to exit" });
  else if (app.escPrimed) {
    const escLabel = app.escAction === "tree" ? "Esc again for tree" : "Esc again to stop";
    parts.push({ text: `${ERR()}${escLabel}${RESET}`, plain: escLabel });
  }
  if (app.isStreaming) parts.push({ text: `${DIM}esc${RESET} ${DIM}stop${RESET}`, plain: "esc stop" });

  const settings = getSettings();
  const modeLabel = app.mode === "plan" ? "plan" : "build";
  parts.push({ text: `${app.mode === "plan" ? P() : T()}${modeLabel}${RESET}`, plain: modeLabel });
  const thinkLevel = settings.thinkingLevel || (settings.enableThinking ? "low" : "off");
  if (thinkLevel !== "off") parts.push({ text: `${T()}${thinkLevel}${RESET}`, plain: thinkLevel });
  const caveLevel = settings.cavemanLevel ?? "auto";
  if (caveLevel !== "off") parts.push({ text: `🪨 ${WARN()}${caveLevel}${RESET}`, plain: `rock ${caveLevel}` });
  const liveTokens = app.getLiveTotalTokens();
  if ((settings.showCost && app.sessionCost > 0) || (settings.showTokens && !hasSidebar && liveTokens > 0)) {
    const costPart = settings.showCost && app.sessionCost > 0 ? fmtCost(app.animCost.get()) : "";
    const tokenPart = settings.showTokens && !hasSidebar && liveTokens > 0
      ? app.renderTokenSummaryParts().filter((part: string) => !(settings.showCost && (part.startsWith("$") || part === "local"))).join(" ")
      : "";
    const statStr = [costPart, tokenPart].filter(Boolean).join(" · ");
    parts.push({ text: `${DIM}${statStr}${RESET}`, plain: statStr });
  }

  const visible = [...parts];
  const sep = " | ";
  while (visible.length > 1) {
    const totalWidth = visible.reduce((s, part) => s + part.plain.length, 0) + (visible.length - 1) * sep.length + 2;
    if (totalWidth <= mainW) break;
    visible.pop();
  }
  return ` ${visible.map((part) => part.text).join(`${DIM}${sep}${RESET}`)}`;
}
