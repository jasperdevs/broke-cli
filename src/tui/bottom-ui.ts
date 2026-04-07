import { getSettings } from "../core/config.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { fmtCost } from "./render/formatting.js";
import { ERR, P, T, WARN } from "./app-shared.js";

type AppState = any;

function renderMenuCount(current: number, total: number): string {
  return `${DIM}(${current}/${total})${RESET}`;
}

export function appendBottomMenus(
  app: AppState,
  bottomLines: string[],
  bottomMenuClicks: Array<{ lineIndex: number; action: () => void }>,
  height: number,
  mainW: number,
  separatorColor: string,
): void {
  if (app.filePicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendFilePicker(bottomLines, height, bottomMenuClicks);
    return;
  }
  if (app.itemPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendItemPicker(bottomLines, height, bottomMenuClicks);
    return;
  }
  if (app.settingsPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendSettingsPicker(bottomLines, height, bottomMenuClicks);
    return;
  }
  if (app.modelPicker) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    app.appendModelPicker(bottomLines, height, bottomMenuClicks);
    return;
  }

  const allSuggestions = app.getCommandSuggestionEntries();
  const suggestions = app.buildMenuView(allSuggestions, app.cmdSuggestionCursor, Math.max(1, getSettings().autocompleteMaxVisible));
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
  else if (app.escPrimed) parts.push({ text: `${ERR()}Esc again to stop${RESET}`, plain: "Esc again to stop" });
  if (app.isStreaming) parts.push({ text: `${DIM}esc${RESET} ${DIM}stop${RESET}`, plain: "esc stop" });

  const settings = getSettings();
  const modeLabel = app.mode === "plan" ? "plan" : "build";
  parts.push({ text: `${app.mode === "plan" ? P() : T()}${modeLabel}${RESET}`, plain: modeLabel });
  const thinkLevel = settings.thinkingLevel || (settings.enableThinking ? "low" : "off");
  if (thinkLevel !== "off") parts.push({ text: `${T()}${thinkLevel}${RESET}`, plain: thinkLevel });
  const caveLevel = settings.cavemanLevel ?? "auto";
  if (caveLevel !== "off") parts.push({ text: `🪨 ${WARN()}${caveLevel}${RESET}`, plain: `rock ${caveLevel}` });
  if (app.getAgentRuns && app.getAgentRuns().length > 0) {
    parts.push({ text: `${DIM}alt+a${RESET} ${DIM}agents${RESET}`, plain: "alt+a agents" });
  }

  const liveTokens = app.getLiveTotalTokens();
  if ((settings.showCost && app.sessionCost > 0) || (settings.showTokens && !hasSidebar && liveTokens > 0)) {
    const costPart = settings.showCost && app.sessionCost > 0 ? fmtCost(app.animCost.get()) : "";
    const tokenPart = settings.showTokens && !hasSidebar && liveTokens > 0 ? app.renderTokenSummaryParts().join(" ") : "";
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
