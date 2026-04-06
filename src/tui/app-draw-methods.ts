import stripAnsi from "strip-ansi";
import { execSync, spawnSync } from "child_process";
import { getSettings } from "../core/config.js";
import { renderBudgetDashboard } from "../core/budget-insights.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { truncateVisible, visibleWidth } from "../utils/terminal-width.js";
import { resolveNativeCommand } from "../ai/native-cli.js";
import { resolveNativeSpawnCommand } from "../ai/native-stream.js";
import { getCommandMatches as findCommandMatches } from "./command-surface.js";
import { fmtCost, fmtTokens, wordWrap } from "./render/formatting.js";
import { APP_BG, ERR, MUTED, OK, P, T, TXT, WARN } from "./app-shared.js";
import { drawQuestionView } from "./question-view.js";

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
  app.screen.setAlternateScreen?.(!!(
    app.budgetView
    || app.agentRunView
    || app.questionView
    || app.filePicker
    || app.itemPicker
    || app.settingsPicker
    || app.modelPicker
  ));
  if (app.budgetView) {
    drawBudgetView(app);
    return;
  }
  if (app.agentRunView) {
    drawAgentRunsView(app);
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

  bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
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

  if (app.isStreaming || app.isCompacting || app.modelPicker || app.settingsPicker || app.itemPicker || Date.now() < app.hideCursorUntil) {
    app.screen.hideCursor();
    return;
  }
  const mainTopHeight = Math.max(0, height - bottomLines.length);
  app.screen.setCursor(Math.min(height, mainTopHeight + 2 + inputLayout.row), Math.min(width, 1 + inputLayout.col));
}

function drawBudgetView(app: AppState): void {
  const { width, height } = app.screen;
  const separatorColor = app.getModeAccent();
  const title = `${T()}${BOLD}${app.budgetView.title}${RESET}`;
  const report = app.budgetView.reports[app.budgetView.scope];
  const scopeLabel = app.budgetView.scope === "all" ? "all sessions" : "current session";
  const scopeToggleHint = app.budgetView.scope === "all" ? "tab current" : "tab all";
  const leftPad = 3;
  const bodyWidth = Math.max(20, width - leftPad - 4);
  const bodyHeight = Math.max(1, height - 8);
  const allLines = renderBudgetDashboard({
    report,
    width: bodyWidth,
    scopeLabel,
    contextTokens: app.contextTokenCount,
    contextLimit: app.contextLimitTokens,
    showContext: app.budgetView.scope === "session",
  });
  const maxScroll = Math.max(0, allLines.length - bodyHeight);
  if (app.budgetView.scrollOffset > maxScroll) app.budgetView.scrollOffset = maxScroll;
  const visible = allLines.slice(app.budgetView.scrollOffset, app.budgetView.scrollOffset + bodyHeight);
  const thumbRow = maxScroll > 0 ? Math.round((app.budgetView.scrollOffset / Math.max(maxScroll, 1)) * Math.max(0, bodyHeight - 1)) : -1;

  const frame: string[] = [];
  const topRule = `${separatorColor}${"─".repeat(width)}${RESET}`;
  frame.push(topRule);
  frame.push("");
  frame.push("");
  frame.push(`${" ".repeat(leftPad)}${title}`);
  frame.push(`${" ".repeat(leftPad)}${DIM}${scopeLabel}${RESET}${DIM} · ${scopeToggleHint} · esc back${RESET}`);
  frame.push("");
  for (let i = 0; i < bodyHeight; i++) {
    const line = visible[i] ?? "";
    const indicator = maxScroll > 0 ? (i === thumbRow ? `${T()}█${RESET}` : `${DIM}│${RESET}`) : " ";
    frame.push(`${" ".repeat(leftPad)}${app.padLine(line, bodyWidth)} ${indicator}`);
  }
  while (frame.length < height) frame.push("");
  app.screen.render(frame.map((line) => app.decorateFrameLine(line, width)));
  app.screen.hideCursor();
}

function drawAgentRunsView(app: AppState): void {
  const { width, height } = app.screen;
  const separatorColor = app.getModeAccent();
  const title = `${T()}${BOLD}${app.agentRunView.title}${RESET}`;
  const listWidth = Math.min(38, Math.max(24, Math.floor(width * 0.36)));
  const detailWidth = Math.max(20, width - listWidth - 3);
  const rows = Math.max(1, height - 3);
  const runs = app.agentRunView.runs;
  const selectedIndex = Math.max(0, Math.min(runs.length - 1, app.agentRunView.selectedIndex));
  app.agentRunView.selectedIndex = selectedIndex;
  const maxScroll = Math.max(0, runs.length - rows);
  if (selectedIndex < app.agentRunView.scrollOffset) app.agentRunView.scrollOffset = selectedIndex;
  if (selectedIndex >= app.agentRunView.scrollOffset + rows) app.agentRunView.scrollOffset = Math.max(0, selectedIndex - rows + 1);
  if (app.agentRunView.scrollOffset > maxScroll) app.agentRunView.scrollOffset = maxScroll;

  const frame: string[] = [];
  const count = renderMenuCount(runs.length === 0 ? 0 : selectedIndex + 1, runs.length);
  frame.push(`${separatorColor}${"─".repeat(width)}${RESET}`);
  const headerRight = `${count} ${DIM}esc back${RESET}`;
  frame.push(` ${title}${" ".repeat(Math.max(1, width - 2 - visibleWidth(title) - visibleWidth(headerRight)))}${headerRight}`);

  const visibleRuns = runs.slice(app.agentRunView.scrollOffset, app.agentRunView.scrollOffset + rows);
  const selectedRun = runs[selectedIndex];
  const detailLines = selectedRun
    ? buildAgentRunDetail(app, selectedRun, detailWidth)
    : [`${DIM}no agent runs yet${RESET}`];

  for (let i = 0; i < rows; i++) {
    const run = visibleRuns[i];
    const absoluteIndex = app.agentRunView.scrollOffset + i;
    const selected = absoluteIndex === selectedIndex;
    const left = run ? app.padLine(renderAgentRunListItem(run, selected, listWidth), listWidth) : app.padLine("", listWidth);
    const right = app.padLine(detailLines[i] ?? "", detailWidth);
    frame.push(`${left} ${app.getSidebarBorder()} ${right}`);
  }

  while (frame.length < height) frame.push("");
  app.screen.render(frame.map((line) => app.decorateFrameLine(line, width)));
  app.screen.hideCursor();
}

function renderAgentRunListItem(run: { prompt: string; status: "running" | "done" | "error"; detail?: string }, selected: boolean, width: number): string {
  const statusColor = run.status === "error" ? ERR() : run.status === "done" ? DIM : OK();
  const arrow = selected ? `${T()}>${RESET}` : `${DIM} ${RESET}`;
  const label = selected ? `${TXT()}${BOLD}Task${RESET}` : `${DIM}Task${RESET}`;
  const prompt = truncateVisible(run.prompt.replace(/\s+/g, " ").trim() || "[empty]", Math.max(8, width - 10));
  const detail = run.detail ? ` ${DIM}${truncateVisible(run.detail, Math.max(8, width - 8))}${RESET}` : "";
  return `${arrow} ${label} ${statusColor}${truncateVisible(prompt, Math.max(8, width - 10))}${RESET}${detail}`;
}

function buildAgentRunDetail(app: AppState, run: { prompt: string; status: "running" | "done" | "error"; detail?: string; result?: string }, width: number): string[] {
  const lines: string[] = [];
  const statusColor = run.status === "error" ? ERR() : run.status === "done" ? OK() : T();
  const header = `${statusColor}${BOLD}${run.status === "running" ? "Working" : run.status === "error" ? "Error" : "Done"}${RESET}`;
  lines.push(`${header}${run.detail ? ` ${DIM}${run.detail}${RESET}` : ""}`);
  lines.push("");
  lines.push(`${DIM}Task${RESET}`);
  for (const line of wordWrap(run.prompt.replace(/\s+/g, " ").trim(), Math.max(8, width))) lines.push(`${TXT()}${line}${RESET}`);
  lines.push("");
  lines.push(`${DIM}Result${RESET}`);
  const body = (run.result ?? (run.status === "running" ? "Preparing prompt..." : "[empty]")).trim();
  for (const rawLine of body.split(/\r?\n/)) {
    const wrapped = wordWrap(rawLine || " ", Math.max(8, width));
    for (const line of wrapped) lines.push(`${TXT()}${line}${RESET}`);
  }
  return lines;
}

function appendBottomMenus(app: AppState, bottomLines: string[], bottomMenuClicks: Array<{ lineIndex: number; action: () => void }>, height: number, mainW: number, separatorColor: string): void {
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
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(bottomMenuClicks, bottomLines, () => app.applyCommandSuggestion(entry.selectIndex!));
    bottomLines.push(entry.text);
  }
}

function buildInfoBar(app: AppState, hasSidebar: boolean, mainW: number): string {
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
  if (app.getAgentRuns && app.getAgentRuns().length > 0) parts.push({ text: `${DIM}alt+a${RESET} ${DIM}agents${RESET}`, plain: "alt+a agents" });

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
    const totalWidth = visible.reduce((s, p) => s + p.plain.length, 0) + (visible.length - 1) * sep.length + 2;
    if (totalWidth <= mainW) break;
    visible.pop();
  }
  return ` ${visible.map((p) => p.text).join(`${DIM}${sep}${RESET}`)}`;
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
  lines.push(` ${T()}${BOLD}Select model${RESET} ${renderMenuCount(total === 0 ? 0 : picker.cursor + 1, total)}`);
  const allLabel = picker.scope === "all" ? `${TXT()}${BOLD}all${RESET}` : `${MUTED()}all${RESET}`;
  const scopedLabel = picker.scope === "scoped" ? `${TXT()}${BOLD}pinned${RESET}` : `${MUTED()}pinned${RESET}`;
  lines.push(` ${DIM}Scope:${RESET} ${allLabel} ${DIM}|${RESET} ${scopedLabel}`);
  lines.push(` ${DIM}space pin · tab scope${RESET}`);
  if (app.getFilteredModels().length === 0) {
    lines.push(`  ${DIM}no matches${RESET}`);
    return;
  }
  for (const entry of app.buildMenuView(app.getModelPickerEntries(), picker.cursor, 12)) {
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
  const maxItems = Math.max(1, maxTotal - 4);
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
  for (const entry of app.buildMenuView(app.getSettingsPickerEntries(), picker.cursor, 6)) {
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
  for (const entry of app.buildMenuView(app.getItemPickerEntries(), picker.cursor, 10)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectItemEntry(entry.selectIndex!));
    lines.push(entry.text);
  }
}

export function getCommandMatches(app: AppState) {
  return findCommandMatches(app.input.getText(), { hasAgentRuns: (app.getAgentRuns?.().length ?? 0) > 0 });
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
  console.log(`${T()}${BOLD} BrokeCLI${RESET} ${DIM}session ended${RESET}`);
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
