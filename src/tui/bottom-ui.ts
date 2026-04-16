import { getSettings } from "../core/config.js";
import { getEffectiveThinkingLevel } from "../ai/thinking.js";
import { getPrettyModelName } from "../ai/model-catalog.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { ERR, P, T, TXT, WARN } from "./app-shared.js";
import { visibleWidth } from "../utils/terminal-width.js";
import { currentQuestionField, getQuestionBodyLines, getQuestionHeader, getQuestionOptionEntries, isQuestionSubmitTab } from "./question-view.js";
import { getActiveMenuDetail } from "./app-menu-entries.js";
import { renderPendingMessagesBlock } from "./render/chat.js";
import { fmtTokens } from "./render/formatting.js";
import { getKeybinding } from "../core/keybindings.js";

type AppState = any;

function renderMenuCount(current: number, total: number): string {
  return `${DIM}(${current}/${total})${RESET}`;
}

type FooterPart = { text: string; plain: string };

function getWrappedMenuDetailLines(app: AppState, mainW: number): string[] {
  const detail = getActiveMenuDetail(app);
  if (!detail) return [];
  const trimmed = detail.trim();
  if (!trimmed) return [];
  const maxWidth = Math.max(12, mainW - 2);
  const rawLines = trimmed.split("\n");
  const lines: string[] = [];
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.length <= maxWidth) {
      lines.push(line);
    } else {
      const words = line.split(/\s+/u).filter(Boolean);
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
        if (lines.length >= 2) break;
      }
      if (lines.length < 2 && current) lines.push(current);
    }
    if (lines.length >= 2) break;
  }
  if (lines.length === 0) return [];
  if (trimmed.length > lines.join(" ").length && lines.length === 2) {
    const last = lines[1]!;
    lines[1] = last.length >= maxWidth ? `${last.slice(0, Math.max(0, maxWidth - 1))}…` : `${last}…`;
  }
  return lines.slice(0, 2);
}

function appendMenuDetailLine(app: AppState, bottomLines: string[], mainW: number): void {
  for (const line of getWrappedMenuDetailLines(app, mainW)) {
    bottomLines.push(` ${DIM}${line}${RESET}`);
  }
}

export function getMenuDetailLineCount(app: AppState, mainW: number): number {
  return getWrappedMenuDetailLines(app, mainW).length;
}

export function getPendingImagePromptLines(app: AppState, mainW: number): string[] {
  void app;
  void mainW;
  return [];
}

export function getPendingFilePromptLines(app: AppState, mainW: number): string[] {
  void app;
  void mainW;
  return [];
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
    Math.max(1, Math.min(maxVisibleRows, height - bottomLines.length - tailReserve - chromeLines));

  if (app.filePicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendFilePicker(bottomLines, getAvailableBodyRows(2), bottomMenuClicks);
    return;
  }
  if (app.itemPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendItemPicker(bottomLines, getAvailableBodyRows(2), bottomMenuClicks);
    appendMenuDetailLine(app, bottomLines, mainW);
    return;
  }
  if (app.settingsPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendSettingsPicker(bottomLines, getAvailableBodyRows(2), bottomMenuClicks);
    appendMenuDetailLine(app, bottomLines, mainW);
    return;
  }
  if (app.modelPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendModelPicker(bottomLines, getAvailableBodyRows(2), bottomMenuClicks);
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

function buildInfoBarParts(app: AppState, hasSidebar: boolean): FooterPart[] {
  const parts: FooterPart[] = [];
  if (app.ctrlCCount === 1) parts.push({ text: `${ERR()}Ctrl+C again to exit${RESET}`, plain: "Ctrl+C again to exit" });
  else if (app.escPrimed) parts.push({ text: `${ERR()}Esc again to stop${RESET}`, plain: "Esc again to stop" });
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
  if (caveLevel !== "off") parts.push({ text: `${WARN()}◆${RESET} ${WARN()}${caveLevel}${RESET}`, plain: `caveman ${caveLevel}` });
  const liveTokens = app.getLiveTotalTokens();
  if (settings.showTokens && !hasSidebar && liveTokens > 0) {
    const tokenPart = app.renderTokenSummaryParts()
      .filter((part: string) => !(part.startsWith("$") || part === "local/unpriced"))
      .join(" ");
    const statStr = tokenPart;
    parts.push({ text: `${DIM}${statStr}${RESET}`, plain: statStr });
  }
  if (!hasSidebar && app.contextTokenCount > 0) {
    const contextPart = `${fmtTokens(app.contextTokenCount)} ctx`;
    parts.push({ text: `${DIM}${contextPart} ${Math.round(app.contextUsed)}%${RESET}`, plain: `${contextPart} ${Math.round(app.contextUsed)}%` });
  }
  return parts;
}

function packFooterParts(parts: FooterPart[], width: number): string[] {
  const rows: string[] = [];
  const sepText = `${DIM} | ${RESET}`;
  const sepPlain = " | ";
  let currentText = " ";
  let currentPlain = "";

  for (const part of parts) {
    if (!part.plain.trim()) continue;
    const candidatePlain = currentPlain ? `${currentPlain}${sepPlain}${part.plain}` : part.plain;
    if (currentPlain && visibleWidth(` ${candidatePlain}`) > width) {
      rows.push(currentText);
      currentText = ` ${part.text}`;
      currentPlain = part.plain;
      continue;
    }
    currentText += currentPlain ? `${sepText}${part.text}` : part.text;
    currentPlain = candidatePlain;
  }

  if (currentPlain) rows.push(currentText);
  return rows;
}

export function buildInfoBar(app: AppState, hasSidebar: boolean, mainW: number): string {
  const rows = packFooterParts(buildInfoBarParts(app, hasSidebar), mainW);
  return rows[0] ?? "";
}

function formatFooterBinding(binding: string): string {
  return binding
    .replace(/return/g, "enter")
    .replace(/\+/g, " + ");
}

function renderFooterShortcut(key: string, label: string): { text: string; plain: string } {
  const plain = `${key} ${label}`;
  return {
    text: `${TXT()}${key}${RESET} ${DIM}${label}${RESET}`,
    plain,
  };
}

function renderFooterRow(
  left: { text: string; plain: string },
  right: { text: string; plain: string } | null,
  width: number,
): string {
  if (!right) return ` ${left.text}`;
  const gap = 5;
  const leftWidth = left.plain.length;
  const rightWidth = right.plain.length;
  if (leftWidth + gap + rightWidth + 1 > width) return ` ${left.text}`;
  const spacing = Math.max(gap, width - 1 - leftWidth - rightWidth);
  return ` ${left.text}${" ".repeat(spacing)}${right.text}`;
}

export function buildFooterLines(app: AppState, hasSidebar: boolean, mainW: number): string[] {
  if (app.messages.length === 0) return [];
  const infoRows = packFooterParts(buildInfoBarParts(app, hasSidebar), mainW);
  const lines = infoRows.length > 0 ? [...infoRows] : [];
  if (app.isStreaming && app.input.getText().trim().length > 0) {
    lines.push(` ${DIM}${formatFooterBinding(getKeybinding("queueMessage"))} to queue message${RESET}`);
  }
  return lines;
}

export function buildLegacyFooterLines(app: AppState, hasSidebar: boolean, mainW: number): string[] {
  const newlineBinding = formatFooterBinding(getKeybinding("newline"));
  const queueBinding = formatFooterBinding(getKeybinding("queueMessage"));
  const modeBinding = formatFooterBinding(getKeybinding("toggleMode"));
  const rows: Array<[{ text: string; plain: string }, { text: string; plain: string } | null]> = [
    [
      renderFooterShortcut("/", "for commands"),
      renderFooterShortcut("!", "for shell commands"),
    ],
    [
      renderFooterShortcut(newlineBinding, "for newline"),
      renderFooterShortcut(queueBinding, "to queue message"),
    ],
    [
      renderFooterShortcut("@", "for file paths"),
      renderFooterShortcut("ctrl + c", "to exit"),
    ],
    [
      renderFooterShortcut("ctrl + t", "to cycle thinking"),
      renderFooterShortcut(modeBinding, "to change mode"),
    ],
  ];

  if (app.isStreaming) {
    rows[3] = [
      renderFooterShortcut("esc", "to stop"),
      renderFooterShortcut("shift + tab", "to change mode"),
    ];
  }

  const lines = rows.map(([left, right]) => renderFooterRow(left, right, mainW));
  if (hasSidebar) {
    const info = buildInfoBar(app, hasSidebar, mainW).trimEnd();
    if (info.trim()) lines.push(info);
  }
  return lines;
}
