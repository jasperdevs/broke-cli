import stripAnsi from "strip-ansi";
import { execSync, spawnSync } from "child_process";
import { clearRuntimeSettings, getSettings, loadConfig, setRuntimeSettings } from "../core/config.js";
import { listAuthenticated } from "../core/auth.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { truncateVisible, visibleWidth } from "../utils/terminal-width.js";
import { resolveNativeCommand } from "../ai/native-cli.js";
import { resolveNativeSpawnCommand } from "../ai/native-stream.js";
import { getCommandMatches as findCommandMatches } from "./command-surface.js";
import { fmtCost, fmtTokens, wordWrap } from "./render/formatting.js";
import { APP_BG, ERR, MUTED, OK, P, SIDEBAR_BG, T, TXT, WARN } from "./app-shared.js";
import { getQuestionCursor } from "./question-view.js";
import { drawBudgetView } from "./fullscreen-views.js";
import { appendBottomMenus, buildFooterLines, getPendingMessagePromptLines, getStatusPromptLines } from "./bottom-ui.js";
import { getTreePickerEntries, getVisibleTreeRows } from "./tree-view.js";

type AppState = any;

function renderMenuCount(current: number, total: number): string {
  return `${DIM}(${current}/${total})${RESET}`;
}

function renderFilterLabel(query: string | undefined): string {
  if (!query) return "";
  return `${DIM} · filter ${query}${RESET}`;
}

function renderMenuHeader(title: string, current: number, filtered: number, total: number, query?: string): string {
  const countCurrent = filtered === 0 ? 0 : current;
  const totalLabel = filtered === total ? renderMenuCount(countCurrent, filtered) : `${DIM}(${countCurrent}/${filtered} shown · ${total} total)${RESET}`;
  return ` ${T()}${BOLD}${title}${RESET} ${totalLabel}${renderFilterLabel(query)}`;
}

function renderMenuEmptyState(noun: string, query?: string): string {
  if (query) return ` ${DIM}no ${noun} for ${query}${RESET}`;
  return ` ${DIM}no ${noun}${RESET}`;
}

export function draw(app: AppState): void {
  if (app.drawScheduled) return;
  app.drawScheduled = true;
  queueMicrotask(() => {
    app.drawScheduled = false;
    app.drawImmediate();
  });
}

export function drawNow(app: AppState): void {
  app.drawScheduled = false;
  app.lastDrawTime = 0;
  app.drawImmediate();
}

export function drawImmediate(app: AppState): void {
  app.lastDrawTime = Date.now();
  app.keypress.setMouseTracking(app.shouldEnableMenuMouse());
  if (app.budgetView) {
    drawBudgetView(app);
    return;
  }
  const { height, width } = app.screen;
  const hasSidebar = app.shouldShowSidebar();
  const mainW = hasSidebar ? app.screen.mainWidth : width;
  const inputLayout = app.getInputCursorLayout(app.input.getText(), app.input.getCursor(), mainW);
  const totalComposerLines = app.getWrappedInputLines(app.input.getText(), mainW).length;
  const isHome = app.messages.length === 0;
  const separatorColor = app.getModeAccent();
  const inputLead = `${separatorColor}${BOLD}>${RESET} `;
  const inputLeadWidth = 2;
  const inputContinueLead = `${DIM}·${RESET} `;
  const inputContinueLeadWidth = 2;
  const bottomLines: string[] = [];
  const bottomMenuClicks: Array<{ lineIndex: number; action: () => void }> = [];
  const pendingMessageLines = getPendingMessagePromptLines(app, mainW);
  const statusLines = getStatusPromptLines(app);
  const btwBubbleLines = app.renderBtwBubble(mainW);

  if (btwBubbleLines.length > 0) {
    bottomLines.push(...btwBubbleLines);
    bottomLines.push("");
  }
  if (pendingMessageLines.length > 0) {
    bottomLines.push(...pendingMessageLines);
    bottomLines.push("");
  }
  bottomLines.push("");
  bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
  const inputStartIndex = bottomLines.length;
  bottomLines.push(...inputLayout.lines.map((line: string, index: number) => `${index === 0 ? inputLead : inputContinueLead}${line}`));
  if (totalComposerLines > inputLayout.lines.length) {
    const composerStatus = `${DIM}${Math.min(totalComposerLines, inputLayout.viewportStart + inputLayout.lines.length)}/${totalComposerLines} lines${RESET}`;
    bottomLines.push(`${" ".repeat(inputLeadWidth)}${composerStatus}`);
  }
  if (statusLines.length > 0) {
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    bottomLines.push(...statusLines);
  }

  appendBottomMenus(app, bottomLines, bottomMenuClicks, height, mainW, separatorColor);
  bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
  bottomLines.push(...buildFooterLines(app, hasSidebar, mainW));
  const footerLines = hasSidebar ? app.renderSidebarFooter() : [];
  const sidebarColumnLines = hasSidebar ? buildSidebarColumnLines(app, height, footerLines) : [];
  const mainTopHeight = Math.max(0, height - bottomLines.length);

  const frameLines = buildFrameLines(app, {
    height,
    mainW,
    hasSidebar,
    sidebarColumnLines,
    bottomLines,
    bottomMenuClicks,
    isHome,
  });
  app.screen.render(frameLines.map((line) => app.decorateFrameLine(line, width)));
  if (app.questionView) {
    const questionCursor = getQuestionCursor(app, mainW);
    if (!questionCursor) {
      app.screen.hideCursor();
      return;
    }
    app.screen.setCursor(
      Math.min(height, mainTopHeight + inputStartIndex + 3 + questionCursor.rowOffset),
      Math.min(width, questionCursor.col),
    );
    return;
  }
  const inputLeadOffset = inputLayout.row === 0 ? inputLeadWidth : inputContinueLeadWidth;
  app.screen.setCursor(
    Math.min(height, mainTopHeight + inputStartIndex + 1 + inputLayout.row),
    Math.min(width, 1 + inputLeadOffset + inputLayout.col),
  );
}

function buildFrameLines(app: AppState, opts: { height: number; mainW: number; hasSidebar: boolean; sidebarColumnLines: string[]; bottomLines: string[]; bottomMenuClicks: Array<{ lineIndex: number; action: () => void }>; isHome: boolean; }): string[] {
  const { height, mainW, hasSidebar, sidebarColumnLines, bottomLines, bottomMenuClicks, isHome } = opts;
  const frameLines: string[] = [];
  const mainBottomHeight = bottomLines.length;
  const mainTopHeight = Math.max(0, height - mainBottomHeight);
  app.activeMenuClickTargets = new Map(bottomMenuClicks.map(({ lineIndex, action }) => [mainTopHeight + lineIndex + 1, action]));
  const showCompactHeader = !isHome && !hasSidebar && app.modelName !== "none";
  const bannerLines = opts.isHome ? app.renderUpdateBanner(mainW) : [];
  const reservedBannerLines = bannerLines.slice(0, mainTopHeight);
  const fixedTopLines = [...reservedBannerLines];
  if (showCompactHeader && fixedTopLines.length < mainTopHeight) fixedTopLines.push(app.renderCompactHeader());
  const mainTopLines: string[] = [];

  if (isHome) {
    const homeLines = app.renderHomeView(mainW, Math.max(0, mainTopHeight - fixedTopLines.length));
    mainTopLines.push(...fixedTopLines, ...homeLines);
  } else {
    const chatH = Math.max(1, mainTopHeight - fixedTopLines.length);
    const messageLines = app.renderMessages(app.getTranscriptRenderWidth());
    const viewport = app.syncTranscriptViewport(messageLines, chatH);
    const visibleMsgs = messageLines.slice(viewport.scrollOffset, viewport.scrollOffset + chatH);
    mainTopLines.push(...fixedTopLines, ...visibleMsgs);
  }

  while (mainTopLines.length < mainTopHeight) mainTopLines.push("");

  if (!hasSidebar) {
    frameLines.push(...mainTopLines, ...bottomLines);
  } else {
    const sideW = app.screen.sidebarWidth;
    const sidebarBg = SIDEBAR_BG();
    for (let row = 0; row < height; row++) {
      const mainLine = row < mainTopHeight ? mainTopLines[row] ?? "" : bottomLines[row - mainTopHeight] ?? "";
      const sidebarLine = sidebarColumnLines[row] ?? "";
      const paddedSidebar = app.padLine(sidebarLine, sideW);
      const sidebarBody = sidebarBg
        ? `${sidebarBg}${paddedSidebar.replaceAll(RESET, `${RESET}${sidebarBg}`)}${RESET}`
        : paddedSidebar;
      const sidebarLead = sidebarBg ? `${sidebarBg} ${RESET}` : " ";
      frameLines.push(`${app.padLine(mainLine, mainW)}${sidebarLead}${sidebarBody}`);
    }
  }

  while (frameLines.length < height) frameLines.push("");
  if (frameLines.length > height) frameLines.length = height;
  return frameLines;
}

function buildSidebarColumnLines(app: AppState, height: number, footerLines: string[]): string[] {
  const footerHeight = footerLines.length;
  const contentHeight = Math.max(1, height - footerHeight);
  const sidebarLines = app.renderSidebar(contentHeight);
  const columnLines = [...sidebarLines];
  while (columnLines.length < contentHeight) columnLines.push("");
  columnLines.push(...footerLines);
  while (columnLines.length < height) columnLines.push("");
  if (columnLines.length > height) columnLines.length = height;
  return columnLines;
}

export function sparkleSpinner(app: AppState, frame: number, color?: string): string {
  const chars = ["·", "✦", "✧", "·"];
  return `${color ?? T()}${chars[frame % chars.length]}${RESET}`;
}

export function shimmerText(_app: AppState, text: string, frame: number, color = T()): string {
  const rgbMatch = color.match(/38;2;(\d+);(\d+);(\d+)/);
  if (!rgbMatch) return `${color}${text}${RESET}`;
  const tr = parseInt(rgbMatch[1]);
  const tg = parseInt(rgbMatch[2]);
  const tb = parseInt(rgbMatch[3]);
  const dr = Math.round(tr * 0.35);
  const dg = Math.round(tg * 0.35);
  const db = Math.round(tb * 0.35);
  const pos = (frame * 0.62) % (text.length + 6);
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const t = Math.max(0, 1 - Math.abs(i - pos) / 4);
    const r = Math.round(dr + t * (tr - dr));
    const g = Math.round(dg + t * (tg - dg));
    const b = Math.round(db + t * (tb - db));
    result += `\x1b[38;2;${r};${g};${b}m${text[i]}`;
  }
  return result + RESET;
}

export function appendModelPicker(app: AppState, lines: string[], _maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
  if (app.modelLanePicker) {
    const total = app.modelLanePicker.options.length;
    lines.push(renderMenuHeader("Assign selected model", app.modelLanePicker.cursor + 1, total, total));
    lines.push(` ${DIM}${app.modelLanePicker.model.displayName ?? app.modelLanePicker.model.modelId}${RESET}`);
    lines.push(` ${DIM}enter assign · esc back${RESET}`);
    for (const entry of app.buildMenuView(app.getModelLanePickerEntries(), app.modelLanePicker.cursor, Math.max(1, _maxTotal))) {
      if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectModelLaneEntry(entry.selectIndex!));
      lines.push(...entry.lines);
    }
    return;
  }
  const picker = app.modelPicker!;
  const filteredModels = app.getFilteredModels();
  const total = filteredModels.length;
  const maxItems = Math.max(1, _maxTotal);
  lines.push(renderMenuHeader("Select model", total === 0 ? 0 : picker.cursor + 1, total, picker.options.length, app.getMenuFilterQuery() || undefined));
  lines.push(` ${DIM}enter choose use · space favorite · type filter${RESET}`);
  if (filteredModels.length === 0) {
    lines.push(renderMenuEmptyState("models", app.getMenuFilterQuery() || undefined));
    return;
  }
  for (const entry of app.buildMenuView(app.getModelPickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectModelEntry(entry.selectIndex!));
      lines.push(...entry.lines);
  }
}

export function decorateFrameLine(_app: AppState, line: string, targetWidth: number): string {
  const visible = visibleWidth(line);
  const content = visible > targetWidth ? truncateVisible(line, targetWidth) : line;
  const padded = Math.max(0, targetWidth - Math.min(visible, targetWidth));
  const bg = APP_BG();
  if (!bg) return `${content}${" ".repeat(padded)}`;
  return `${bg}${content.replaceAll(RESET, `${RESET}${bg}`)}${bg}${" ".repeat(padded)}${RESET}`;
}

export function appendFilePicker(app: AppState, lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
  const picker = app.filePicker!;
  lines.push(renderMenuHeader("Files", picker.filtered.length === 0 ? 0 : picker.cursor + 1, picker.filtered.length, picker.files.length, picker.query || undefined));
  lines.push(` ${DIM}enter attach · tab attach · type filter · esc close${RESET}`);
  const maxItems = Math.max(1, Math.min(getSettings().autocompleteMaxVisible, maxTotal));
  for (const entry of app.buildMenuView(app.getFilePickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectFileEntry(entry.selectIndex!));
      lines.push(...entry.lines);
  }
  if (picker.filtered.length === 0) lines.push(renderMenuEmptyState("files", picker.query || undefined));
}

export function appendSettingsPicker(app: AppState, lines: string[], _maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
  const picker = app.settingsPicker!;
  const filtered = app.getFilteredSettings();
  lines.push(renderMenuHeader("Settings", filtered.length === 0 ? 0 : picker.cursor + 1, filtered.length, picker.entries.length, app.getMenuFilterQuery() || undefined));
  lines.push(` ${DIM}enter toggle · type filter · esc close${RESET}`);
  if (filtered.length === 0) {
    lines.push(renderMenuEmptyState("settings", app.getMenuFilterQuery() || undefined));
    return;
  }
  const maxItems = Math.max(1, Math.min(getSettings().autocompleteMaxVisible, _maxTotal));
  for (const entry of app.buildMenuView(app.getSettingsPickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.toggleSettingEntry(entry.selectIndex!));
      lines.push(...entry.lines);
  }
}

export function appendItemPicker(app: AppState, lines: string[], _maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
  const picker = app.itemPicker!;
  const filtered = app.getFilteredItems();
  lines.push(renderMenuHeader(picker.title, filtered.length === 0 ? 0 : picker.cursor + 1, filtered.length, picker.items.length, app.getMenuFilterQuery() || undefined));
  lines.push(` ${DIM}enter choose · type filter · esc close${RESET}`);
  if (filtered.length === 0) {
    lines.push(renderMenuEmptyState("items", app.getMenuFilterQuery() || undefined));
    return;
  }
  const maxItems = Math.max(1, Math.min(getSettings().autocompleteMaxVisible, _maxTotal));
  for (const entry of app.buildMenuView(app.getItemPickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectItemEntry(entry.selectIndex!));
    lines.push(...entry.lines);
  }
}

export function appendTreePicker(app: AppState, lines: string[], maxItems: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
  const rows = getVisibleTreeRows(app);
  const selectedIndex = Math.max(0, rows.findIndex((row) => row.item.id === app.treeView?.selectedId));
  const total = rows.length;
  lines.push(renderMenuHeader(app.treeView!.title, total === 0 ? 0 : selectedIndex + 1, total, total, app.getMenuFilterQuery() || undefined));
  lines.push(` ${DIM}enter jump · shift+f fork · shift+r rename · shift+d prune · shift+c copy · esc back${RESET}`);
  if (rows.length === 0) {
    lines.push(renderMenuEmptyState("sessions", app.getMenuFilterQuery() || undefined));
    return;
  }
  for (const entry of app.buildMenuView(getTreePickerEntries(app), selectedIndex, Math.max(1, Math.min(getSettings().autocompleteMaxVisible, maxItems)))) {
    if (entry.selectIndex !== undefined) {
      app.registerMenuClickTarget(clickTargets, lines, () => {
        const target = rows[entry.selectIndex!];
        if (!target) return;
        app.treeView.selectedId = target.item.id;
        app.selectTreeEntry();
      });
    }
    lines.push(...entry.lines);
  }
}

export function getCommandMatches(app: AppState) {
  const configuredAuth = Object.values(loadConfig().providers ?? {}).some((provider) => !!provider?.apiKey);
  return findCommandMatches(app.input.getText(), {
    hasMessages: app.messages.length > 0,
    hasAssistantContent: !!app.getLastAssistantContent(),
    canResume: getSettings().autoSaveSessions,
    hasStoredAuth: configuredAuth || listAuthenticated().length > 0,
  });
}

export function start(app: AppState): void {
  app.running = true;
  setRuntimeSettings({
    autocompleteMaxVisible: 8,
    showHardwareCursor: true,
  });
  try { app.gitBranch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 3000, stdio: "pipe" }).trim(); } catch {}
  try { app.gitDirty = execSync("git status --porcelain", { encoding: "utf-8", timeout: 3000, stdio: "pipe" }).trim().length > 0; } catch {}
  app.screen.enter();
  app.keypress.start();
  app.refreshWindowTitle();
  app.draw();
  process.stdout.on("resize", app.handleResize);
}

export function stop(app: AppState): void {
  if (!app.running) return;
  app.running = false;
  clearRuntimeSettings();
  if (app.spinnerTimer) clearInterval(app.spinnerTimer);
  app.clearInterruptPrompt();
  app.setSessionName("broke-cli");
  process.stdout.off("resize", app.handleResize);
  app.keypress.stop();
  app.screen.exit();
  app.screen.dispose();
  console.log("");
  console.log(`${T()}${BOLD} Session${RESET} ${DIM}ended${RESET}`);
  console.log(`${DIM} ${fmtCost(app.sessionCost)} | ${fmtTokens(app.sessionTokens)} tokens${RESET}`);
  console.log("");
  process.exit(0);
}

export function runExternalCommand(app: AppState, _title: string, commandName: string, args: string[]): number {
  const resolved = resolveNativeCommand(commandName);
  if (!resolved) return 1;
  const spawnTarget = resolveNativeSpawnCommand(resolved, args);
  app.screen.setAlternateScreen?.(false);
  app.screen.exit();
  app.keypress.stop();
  const result = spawnSync(spawnTarget.command, spawnTarget.args, { stdio: "inherit" });
  app.screen.enter();
  app.keypress.start();
  app.refreshWindowTitle();
  app.drawNow();
  if (typeof result.status === "number") return result.status;
  return result.error ? 1 : 0;
}
