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
  bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
  const inputStartIndex = bottomLines.length;
  bottomLines.push(...inputLayout.lines.map((line: string, index: number) => `${index === 0 ? inputLead : inputContinueLead}${line}`));
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
    const maxScroll = Math.max(0, messageLines.length - chatH);
    if (app.transcriptAutoFollow) app.scrollOffset = maxScroll;
    if (app.scrollOffset > maxScroll) app.scrollOffset = maxScroll;
    if (app.scrollOffset < 0) app.scrollOffset = 0;
    const visibleMsgs = messageLines.slice(app.scrollOffset, app.scrollOffset + chatH);
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
    lines.push(` ${T()}${BOLD}Assign selected model${RESET} ${renderMenuCount(app.modelLanePicker.cursor + 1, total)}`);
    lines.push(` ${DIM}${app.modelLanePicker.model.displayName ?? app.modelLanePicker.model.modelId}${RESET}`);
    for (const entry of app.buildMenuView(app.getModelLanePickerEntries(), app.modelLanePicker.cursor, Math.max(1, _maxTotal))) {
      if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectModelLaneEntry(entry.selectIndex!));
      lines.push(...entry.lines);
    }
    return;
  }
  const picker = app.modelPicker!;
  const total = app.getFilteredModels().length;
  const maxItems = Math.max(1, _maxTotal);
  lines.push(` ${T()}${BOLD}Select model${RESET} ${renderMenuCount(total === 0 ? 0 : picker.cursor + 1, total)}`);
  if (app.getFilteredModels().length === 0) {
    lines.push(`  ${DIM}no matches${RESET}`);
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
  lines.push(` ${T()}${BOLD}Files${RESET} ${renderMenuCount(picker.filtered.length === 0 ? 0 : picker.cursor + 1, picker.filtered.length)}`);
  const maxItems = Math.max(1, Math.min(getSettings().autocompleteMaxVisible, maxTotal));
  for (const entry of app.buildMenuView(app.getFilePickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectFileEntry(entry.selectIndex!));
      lines.push(...entry.lines);
  }
  if (picker.filtered.length === 0) lines.push(` ${DIM}  no matches${RESET}`);
}

export function appendSettingsPicker(app: AppState, lines: string[], _maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
  const picker = app.settingsPicker!;
  const filtered = app.getFilteredSettings();
  lines.push(` ${T()}${BOLD}Settings${RESET} ${renderMenuCount(filtered.length === 0 ? 0 : picker.cursor + 1, filtered.length)}`);
  if (filtered.length === 0) {
    lines.push(`  ${DIM}no matches${RESET}`);
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
  lines.push(` ${T()}${BOLD}${picker.title}${RESET} ${renderMenuCount(filtered.length === 0 ? 0 : picker.cursor + 1, filtered.length)}`);
  if (filtered.length === 0) {
    lines.push(`  ${DIM}no matches${RESET}`);
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
  lines.push(` ${T()}${BOLD}${app.treeView!.title}${RESET} ${renderMenuCount(total === 0 ? 0 : selectedIndex + 1, total)}`);
  lines.push(` ${DIM}enter jump · shift+l label · shift+t time · ctrl+u user · ctrl+o all · esc back${RESET}`);
  if (rows.length === 0) {
    lines.push(`  ${DIM}no matches${RESET}`);
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
    canResume: true,
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
