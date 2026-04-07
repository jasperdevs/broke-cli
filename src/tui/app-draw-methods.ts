import stripAnsi from "strip-ansi";
import { execSync, spawnSync } from "child_process";
import { getSettings, loadConfig } from "../core/config.js";
import { listAuthenticated } from "../core/auth.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { truncateVisible, visibleWidth } from "../utils/terminal-width.js";
import { resolveNativeCommand } from "../ai/native-cli.js";
import { resolveNativeSpawnCommand } from "../ai/native-stream.js";
import { getCommandMatches as findCommandMatches } from "./command-surface.js";
import { fmtCost, fmtTokens, wordWrap } from "./render/formatting.js";
import { APP_BG, ERR, MUTED, OK, P, T, TXT, WARN } from "./app-shared.js";
import { drawQuestionView } from "./question-view.js";
import { drawBudgetView } from "./fullscreen-views.js";
import { appendBottomMenus, buildInfoBar, getPendingImagePromptLines } from "./bottom-ui.js";
import { getTreePickerEntries, getVisibleTreeRows } from "./tree-view.js";

type AppState = any;

function renderMenuCount(current: number, total: number): string {
  return `${DIM}(${current}/${total})${RESET}`;
}

export function draw(app: AppState): void {
  if (app.drawScheduled) return;
  const now = Date.now();
  const elapsed = now - app.lastDrawTime;
  if (elapsed >= app.constructor.DRAW_THROTTLE_MS) {
    app.drawImmediate();
    return;
  }
  app.drawScheduled = true;
  setTimeout(() => {
    app.drawScheduled = false;
    app.drawImmediate();
  }, app.constructor.DRAW_THROTTLE_MS - elapsed);
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
  if (app.questionView) {
    drawQuestionView(app);
    return;
  }
  const { height, width } = app.screen;
  const hasSidebar = app.shouldShowSidebar();
  const mainW = hasSidebar ? app.screen.mainWidth : width;
  const footerLines = hasSidebar ? app.renderSidebarFooter() : [];
  const inputLayout = app.getInputCursorLayout(app.input.getText(), app.input.getCursor(), mainW);
  const isHome = app.messages.length === 0;
  const separatorColor = app.getModeAccent();
  const bottomLines: string[] = [];
  const bottomMenuClicks: Array<{ lineIndex: number; action: () => void }> = [];
  const pendingImageLines = getPendingImagePromptLines(app, mainW);

  bottomLines.push("");
  bottomLines.push(...pendingImageLines);
  bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
  const inputStartIndex = bottomLines.length;
  bottomLines.push(...inputLayout.lines);

  appendBottomMenus(app, bottomLines, bottomMenuClicks, height, mainW, separatorColor);
  bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
  bottomLines.push(buildInfoBar(app, hasSidebar, mainW));
  if (app.statusMessage) bottomLines.push(` ${app.statusMessage}`);

  const frameLines = buildFrameLines(app, {
    height,
    width,
    mainW,
    hasSidebar,
    footerLines,
    bottomLines,
    bottomMenuClicks,
    isHome,
  });
  app.screen.render(frameLines.map((line) => app.decorateFrameLine(line, width)));

  if (Date.now() < app.hideCursorUntil) {
    app.screen.hideCursor();
    return;
  }
  const mainTopHeight = Math.max(0, height - bottomLines.length);
  app.screen.setCursor(Math.min(height, mainTopHeight + inputStartIndex + 1 + inputLayout.row), Math.min(width, 1 + inputLayout.col));
}

function buildFrameLines(app: AppState, opts: { height: number; width: number; mainW: number; hasSidebar: boolean; footerLines: string[]; bottomLines: string[]; bottomMenuClicks: Array<{ lineIndex: number; action: () => void }>; isHome: boolean; }): string[] {
  const { height, mainW, hasSidebar, footerLines, bottomLines, bottomMenuClicks, isHome } = opts;
  const frameLines: string[] = [];
  const mainBottomHeight = bottomLines.length;
  const mainTopHeight = Math.max(0, height - mainBottomHeight);
  const sidebarFooterHeight = hasSidebar ? footerLines.length : 0;
  const sidebarTopHeight = hasSidebar ? Math.max(0, height - sidebarFooterHeight) : 0;
  app.activeMenuClickTargets = new Map(bottomMenuClicks.map(({ lineIndex, action }) => [mainTopHeight + lineIndex + 1, action]));
  const showCompactHeader = !isHome && !hasSidebar && app.modelName !== "none";
  const bannerLines = app.renderUpdateBanner(mainW);
  const reservedBannerLines = bannerLines.slice(0, mainTopHeight);
  const fixedTopLines = [...reservedBannerLines];
  if (showCompactHeader && fixedTopLines.length < mainTopHeight) fixedTopLines.push(app.renderCompactHeader());

  if (isHome) {
    const homeLines = app.renderHomeView(mainW, Math.max(0, mainTopHeight - fixedTopLines.length));
    mergeMainAndSidebar(app, frameLines, [...fixedTopLines, ...homeLines], [], mainW, hasSidebar, sidebarTopHeight, false);
    while (frameLines.length < mainTopHeight) frameLines.push("");
  } else {
    const chatH = Math.max(1, mainTopHeight - fixedTopLines.length);
    const messageLines = app.renderMessages(mainW);
    const previousChatHeight = app.lastChatHeight || chatH;
    const previousMaxScroll = Math.max(0, messageLines.length - previousChatHeight);
    const wasBottomAnchored = app.scrollOffset >= Math.max(0, previousMaxScroll - 1);
    const maxScroll = Math.max(0, messageLines.length - chatH);
    if (wasBottomAnchored) app.scrollOffset = maxScroll;
    if (app.scrollOffset > maxScroll) app.scrollOffset = maxScroll;
    if (app.scrollOffset < 0) app.scrollOffset = 0;
    app.lastChatHeight = chatH;
    const visibleMsgs = messageLines.slice(app.scrollOffset, app.scrollOffset + chatH);
    mergeMainAndSidebar(app, frameLines, [...fixedTopLines, ...visibleMsgs], [], mainW, hasSidebar, sidebarTopHeight, false);
    while (frameLines.length < mainTopHeight) {
      if (hasSidebar) frameLines.push(`${app.padLine("", mainW)} ${app.getSidebarBorder()} ${app.padLine("", app.screen.sidebarWidth)}`);
      else frameLines.push("");
    }
  }

  if (hasSidebar) {
    const border = app.getSidebarBorder();
    const sideW = app.screen.sidebarWidth;
    for (let i = 0; i < mainBottomHeight; i++) {
      const row = frameLines.length;
      const footerLine = row >= sidebarTopHeight ? footerLines[row - sidebarTopHeight] ?? "" : "";
      frameLines.push(`${app.padLine(bottomLines[i] ?? "", mainW)} ${border} ${app.padLine(footerLine, sideW)}`);
    }
  } else {
    frameLines.push(...bottomLines);
  }

  while (frameLines.length < height) frameLines.push("");
  if (frameLines.length > height) frameLines.length = height;
  return frameLines;
}

function mergeMainAndSidebar(app: AppState, frameLines: string[], mainLines: string[], _unused: string[], mainW: number, hasSidebar: boolean, sidebarTopHeight: number, showCompactHeader: boolean): void {
  if (!hasSidebar) {
    frameLines.push(...mainLines);
    return;
  }
  const sidebarLines = app.renderSidebar(Math.max(1, sidebarTopHeight - (showCompactHeader ? 1 : 0)));
  const border = app.getSidebarBorder();
  const rowCount = Math.max(mainLines.length, sidebarLines.length);
  for (let i = 0; i < rowCount; i++) {
    frameLines.push(`${app.padLine(mainLines[i] ?? "", mainW)} ${border} ${app.padLine(sidebarLines[i] ?? "", app.screen.sidebarWidth)}`);
  }
}

export function sparkleSpinner(app: AppState, frame: number, color?: string): string {
  const chars = ["·", "✧", "✦", "✧"];
  return `${color ?? T()}${chars[frame % chars.length]}${RESET}`;
}

export function shimmerText(_app: AppState, text: string, frame: number, color = T()): string {
  const rgbMatch = color.match(/38;2;(\d+);(\d+);(\d+)/);
  const tr = rgbMatch ? parseInt(rgbMatch[1]) : 58;
  const tg = rgbMatch ? parseInt(rgbMatch[2]) : 199;
  const tb = rgbMatch ? parseInt(rgbMatch[3]) : 58;
  const dr = Math.round(tr * 0.55);
  const dg = Math.round(tg * 0.55);
  const db = Math.round(tb * 0.55);
  const pos = (frame * 0.48) % (text.length + 8);
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const t = Math.max(0, 1 - Math.abs(i - pos) / 6);
    const r = Math.round(dr + t * (tr - dr));
    const g = Math.round(dg + t * (tg - dg));
    const b = Math.round(db + t * (tb - db));
    result += `\x1b[38;2;${r};${g};${b}m${text[i]}`;
  }
  return result + RESET;
}

export function appendModelPicker(app: AppState, lines: string[], _maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
  const picker = app.modelPicker!;
  const total = app.getFilteredModels().length;
  const maxItems = Math.max(1, _maxTotal);
  lines.push(` ${T()}${BOLD}Select model${RESET} ${renderMenuCount(total === 0 ? 0 : picker.cursor + 1, total)}`);
  const allLabel = picker.scope === "all" ? `${TXT()}${BOLD}all${RESET}` : `${MUTED()}all${RESET}`;
  const scopedLabel = picker.scope === "scoped" ? `${TXT()}${BOLD}pinned${RESET}` : `${MUTED()}pinned${RESET}`;
  lines.push(` ${DIM}Scope:${RESET} ${allLabel} ${DIM}|${RESET} ${scopedLabel}`);
  lines.push(` ${DIM}enter use · space pin · tab scope${RESET}`);
  lines.push(` ${DIM}1 default · 2 small · 3 review · 4 plan · 5 ui · 6 arch${RESET}`);
  if (app.getFilteredModels().length === 0) {
    lines.push(`  ${DIM}no matches${RESET}`);
    return;
  }
  for (const entry of app.buildMenuView(app.getModelPickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectModelEntry(entry.selectIndex!));
    lines.push(entry.text);
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
  const maxItems = Math.max(1, maxTotal);
  for (const entry of app.buildMenuView(app.getFilePickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectFileEntry(entry.selectIndex!));
    lines.push(entry.text);
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
  const maxItems = Math.max(1, _maxTotal);
  for (const entry of app.buildMenuView(app.getSettingsPickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.toggleSettingEntry(entry.selectIndex!));
    lines.push(entry.text);
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
  const maxItems = Math.max(1, _maxTotal);
  for (const entry of app.buildMenuView(app.getItemPickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectItemEntry(entry.selectIndex!));
    lines.push(entry.text);
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
  for (const entry of app.buildMenuView(getTreePickerEntries(app), selectedIndex, Math.max(1, maxItems))) {
    if (entry.selectIndex !== undefined) {
      app.registerMenuClickTarget(clickTargets, lines, () => {
        const target = rows[entry.selectIndex!];
        if (!target) return;
        app.treeView.selectedId = target.item.id;
        app.selectTreeEntry();
      });
    }
    lines.push(entry.text);
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
  try { app.gitBranch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 3000 }).trim(); } catch {}
  try { app.gitDirty = execSync("git status --porcelain", { encoding: "utf-8", timeout: 3000 }).trim().length > 0; } catch {}
  app.screen.enter();
  app.keypress.start();
  app.draw();
  process.stdout.on("resize", app.handleResize);
}

export function stop(app: AppState): void {
  if (!app.running) return;
  app.running = false;
  if (app.spinnerTimer) clearInterval(app.spinnerTimer);
  app.clearInterruptPrompt();
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
  app.drawNow();
  if (typeof result.status === "number") return result.status;
  return result.error ? 1 : 0;
}
