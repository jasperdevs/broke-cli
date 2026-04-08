import { currentTheme } from "../core/themes.js";
import { getSettings } from "../core/config.js";
import { getEffectiveThinkingLevel } from "../ai/thinking.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { ERR, P, T, TXT, WARN } from "./app-shared.js";
import { visibleWidth } from "../utils/terminal-width.js";
import { currentQuestionField, getQuestionBodyLines, getQuestionHeader, getQuestionOptionEntries, isQuestionSubmitTab } from "./question-view.js";
import { getActiveMenuDetail } from "./app-menu-entries.js";
import { renderPendingMessagesBlock } from "./render/chat.js";

type AppState = any;

function renderMenuCount(current: number, total: number): string {
  return `${DIM}(${current}/${total})${RESET}`;
}

function appendMenuDetailLine(app: AppState, bottomLines: string[], mainW: number): void {
  const detail = getActiveMenuDetail(app);
  if (!detail) return;
  const trimmed = detail.trim();
  if (!trimmed) return;
  const maxWidth = Math.max(12, mainW - 2);
  const line = trimmed.length <= maxWidth ? trimmed : `${trimmed.slice(0, maxWidth - 1)}…`;
  bottomLines.push(` ${DIM}${line}${RESET}`);
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

export function getStatusPromptLines(app: AppState): string[] {
  if (!app.statusMessage) return [];
  return [` ${app.statusMessage}`];
}

export function getPendingMessagePromptLines(app: AppState, mainW: number): string[] {
  return renderPendingMessagesBlock({
    pendingMessages: app.pendingMessages,
    maxWidth: mainW,
    dim: DIM,
    reset: RESET,
  });
}

export function appendBottomMenus(
  app: AppState,
  bottomLines: string[],
  bottomMenuClicks: Array<{ lineIndex: number; action: () => void }>,
  height: number,
  mainW: number,
  separatorColor: string,
): void {
  const maxVisibleRows = Math.max(1, getSettings().autocompleteMaxVisible);
  const tailReserve = 2;
  const getAvailableBodyRows = (chromeLines: number): number =>
    Math.max(1, Math.min(maxVisibleRows, height - bottomLines.length - tailReserve - 1 - chromeLines));

  if (app.filePicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendFilePicker(bottomLines, getAvailableBodyRows(1), bottomMenuClicks);
    return;
  }
  if (app.itemPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendItemPicker(bottomLines, getAvailableBodyRows(1), bottomMenuClicks);
    appendMenuDetailLine(app, bottomLines, mainW);
    return;
  }
  if (app.settingsPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendSettingsPicker(bottomLines, getAvailableBodyRows(1), bottomMenuClicks);
    appendMenuDetailLine(app, bottomLines, mainW);
    return;
  }
  if (app.modelPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendModelPicker(bottomLines, getAvailableBodyRows(4), bottomMenuClicks);
    appendMenuDetailLine(app, bottomLines, mainW);
    return;
  }
  if (app.treeView) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendTreePicker(bottomLines, getAvailableBodyRows(2), bottomMenuClicks);
    return;
  }
  if (app.questionView) {
    const maxVisible = Math.max(1, getAvailableBodyRows(2));
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    bottomLines.push(getQuestionHeader(app.questionView));
    const field = currentQuestionField(app.questionView);
    if (field && field.kind !== "text" && !app.questionView.inputMode && !isQuestionSubmitTab(app.questionView)) {
      const entries = app.buildMenuView(getQuestionOptionEntries(app.questionView), app.questionView.optionCursor, maxVisible);
      const body = getQuestionBodyLines(app.questionView, mainW);
      bottomLines.push(body[0] ?? "");
      for (const entry of entries) bottomLines.push(...entry.lines);
      bottomLines.push(body[body.length - 1] ?? "");
    } else {
      const body = getQuestionBodyLines(app.questionView, mainW);
      const visibleBody = body.slice(0, Math.max(2, maxVisible + 1));
      bottomLines.push(...visibleBody);
    }
    return;
  }

  const allSuggestions = app.getCommandSuggestionEntries();
  const maxVisible = Math.max(1, getAvailableBodyRows(1));
  const suggestions = app.buildMenuView(allSuggestions, app.cmdSuggestionCursor, maxVisible);
  if (suggestions.length > 0) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    bottomLines.push(` ${T()}${BOLD}Commands${RESET} ${renderMenuCount(Math.min(app.cmdSuggestionCursor, allSuggestions.length - 1) + 1, allSuggestions.length)}`);
    appendMenuDetailLine(app, bottomLines, mainW);
  }
  for (const entry of suggestions) {
    if (entry.selectIndex !== undefined) {
      app.registerMenuClickTarget(bottomMenuClicks, bottomLines, () => app.applyCommandSuggestion(entry.selectIndex!));
    }
    bottomLines.push(...entry.lines);
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
  const thinkLevel = getEffectiveThinkingLevel({
    providerId: app.modelProviderId,
    modelId: app.modelName === "none" ? undefined : app.modelName,
    runtime: app.modelRuntime,
    level: settings.thinkingLevel,
    enabled: settings.enableThinking,
  });
  if (thinkLevel !== "off") parts.push({ text: `${T()}${thinkLevel}${RESET}`, plain: thinkLevel });
  const caveLevel = settings.cavemanLevel ?? "auto";
  if (caveLevel !== "off") parts.push({ text: `🪨 ${WARN()}${caveLevel}${RESET}`, plain: `rock ${caveLevel}` });
  const liveTokens = app.getLiveTotalTokens();
  if (settings.showTokens && !hasSidebar && liveTokens > 0) {
    const tokenPart = app.renderTokenSummaryParts()
      .filter((part: string) => !(part.startsWith("$") || part === "local/unpriced"))
      .join(" ")
    const statStr = tokenPart;
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
