import stripAnsi from "strip-ansi";
import { execSync } from "child_process";
import { getSettings } from "../core/config.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { getCommandMatches as findCommandMatches } from "./command-surface.js";
import { fmtCost, fmtTokens, wordWrap } from "./render/formatting.js";
import { APP_BG, ERR, MUTED, P, T, TXT, WARN } from "./app-shared.js";

type AppState = any;

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
  const { height, width } = app.screen;
  const hasSidebar = app.shouldShowSidebar();
  const mainW = hasSidebar ? app.screen.mainWidth : width;
  const footerLines = hasSidebar ? app.renderSidebarFooter() : [];
  const inputLayout = app.getInputCursorLayout(app.input.getText(), app.input.getCursor(), mainW);
  const isHome = app.messages.length === 0;
  const separatorColor = app.getModeAccent();
  const bottomLines: string[] = [];
  const bottomMenuClicks: Array<{ lineIndex: number; action: () => void }> = [];

  appendQueuedMessagePreview(app, bottomLines, mainW);
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

  if (app.isStreaming || app.isCompacting || app.modelPicker || app.settingsPicker || app.itemPicker || app.questionPrompt || Date.now() < app.hideCursorUntil) {
    app.screen.hideCursor();
    return;
  }
  const mainTopHeight = Math.max(0, height - bottomLines.length);
  app.screen.setCursor(Math.min(height, mainTopHeight + 2 + inputLayout.row), Math.min(width, 1 + inputLayout.col));
}

function appendQueuedMessagePreview(app: AppState, bottomLines: string[], mainW: number): void {
  if (app.pendingMessages.length === 0) return;
  const sections: Array<{ title: string; items: Array<{ text: string }> }> = [];
  const steering = app.pendingMessages.filter((entry: { delivery: string }) => entry.delivery === "steering");
  const followups = app.pendingMessages.filter((entry: { delivery: string }) => entry.delivery === "followup");
  if (steering.length > 0) sections.push({ title: "Queued steering messages", items: steering });
  if (followups.length > 0) sections.push({ title: "Queued follow-up messages", items: followups });

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    bottomLines.push(`• ${section.title}`);
    for (const item of section.items) {
      const preview = item.text.replace(/\s+/g, " ").trim();
      for (const line of wordWrap(preview, Math.max(8, mainW - 4)).slice(0, 2)) {
        bottomLines.push(`  ↳ ${line}`);
      }
    }
    bottomLines.push("  alt + ↑ edit last queued message");
    if (i < sections.length - 1) bottomLines.push("");
  }
}

function drawBudgetView(app: AppState): void {
  const { width, height } = app.screen;
  const separatorColor = app.getModeAccent();
  const title = `${T()}${BOLD}${app.budgetView.title}${RESET}`;
  const innerWidth = Math.max(20, width - 6);
  const bodyHeight = Math.max(1, height - 6);
  const allLines = app.budgetView.lines.flatMap((line: string) => {
    if (!line) return [""];
    return stripAnsi(line).length <= innerWidth ? [line] : wordWrap(line, innerWidth);
  });
  const maxScroll = Math.max(0, allLines.length - bodyHeight);
  if (app.budgetView.scrollOffset > maxScroll) app.budgetView.scrollOffset = maxScroll;
  const visible = allLines.slice(app.budgetView.scrollOffset, app.budgetView.scrollOffset + bodyHeight);

  const frame: string[] = [];
  frame.push(`${separatorColor}${"═".repeat(width)}${RESET}`);
  frame.push(` ${title}`);
  frame.push(` ${DIM}${"Budget inspector".padEnd(Math.max(0, width - 2))}${RESET}`);
  for (let i = 0; i < bodyHeight; i++) {
    const line = visible[i] ?? "";
    frame.push(` ${app.padLine(line, width - 2)}`);
  }
  while (frame.length < height - 1) frame.push(" ");
  frame.push(`${separatorColor}${"═".repeat(width)}${RESET}`);
  app.screen.render(frame.map((line) => app.decorateFrameLine(line, width)));
  app.screen.hideCursor();
}

function appendBottomMenus(app: AppState, bottomLines: string[], bottomMenuClicks: Array<{ lineIndex: number; action: () => void }>, height: number, mainW: number, separatorColor: string): void {
  if (app.questionPrompt) {
    const qp = app.questionPrompt;
    bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
    bottomLines.push(` ${T()}?${RESET} ${TXT()}${BOLD}${qp.question}${RESET}`);
    if (qp.options) {
      for (const entry of app.buildMenuView(app.getQuestionOptionEntries(), qp.cursor, 8)) {
        if (entry.selectIndex !== undefined) app.registerMenuClickTarget(bottomMenuClicks, bottomLines, () => app.selectQuestionOption(entry.selectIndex!));
        bottomLines.push(entry.text);
      }
    } else {
      for (const line of app.getWrappedInputLines(qp.textInput, mainW)) bottomLines.push(`  ${line}`);
    }
    return;
  }

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

  const suggestions = app.buildMenuView(app.getCommandSuggestionEntries(), app.cmdSuggestionCursor, 5);
  if (suggestions.length > 0) bottomLines.push(`${separatorColor}${"─".repeat(mainW)}${RESET}`);
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
  const caveLevel = settings.cavemanLevel ?? "off";
  if (caveLevel !== "off") parts.push({ text: `🪨 ${WARN()}${caveLevel}${RESET}`, plain: `rock ${caveLevel}` });

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

  if (isHome) {
    if (showCompactHeader) frameLines.push(app.renderCompactHeader());
    const homeLines = app.renderHomeView(mainW, Math.max(0, mainTopHeight - (showCompactHeader ? 1 : 0)));
    mergeMainAndSidebar(app, frameLines, homeLines, [], mainW, hasSidebar, sidebarTopHeight, showCompactHeader);
    while (frameLines.length < mainTopHeight) frameLines.push("");
  } else {
    if (showCompactHeader) frameLines.push(app.renderCompactHeader());
    const chatH = Math.max(1, mainTopHeight - (showCompactHeader ? 1 : 0));
    const messageLines = app.renderMessages(mainW);
    const maxScroll = Math.max(0, messageLines.length - chatH);
    if (app.scrollOffset > maxScroll) app.scrollOffset = maxScroll;
    if (app.scrollOffset < 0) app.scrollOffset = 0;
    const visibleMsgs = messageLines.slice(app.scrollOffset, app.scrollOffset + chatH);
    mergeMainAndSidebar(app, frameLines, visibleMsgs, [], mainW, hasSidebar, sidebarTopHeight, showCompactHeader);
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
  lines.push(` ${T()}${BOLD}Select model${RESET}`);
  const allLabel = picker.scope === "all" ? `${TXT()}${BOLD}all${RESET}` : `${MUTED()}all${RESET}`;
  const scopedLabel = picker.scope === "scoped" ? `${TXT()}${BOLD}scoped${RESET}` : `${MUTED()}scoped${RESET}`;
  lines.push(` ${DIM}Scope:${RESET} ${allLabel} ${DIM}|${RESET} ${scopedLabel}`);
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
  const visible = stripAnsi(line).length;
  const content = visible > targetWidth ? truncateVisible(line, targetWidth) : line;
  const padded = Math.max(0, targetWidth - Math.min(visible, targetWidth));
  const bg = APP_BG();
  if (!bg) return `${content}${" ".repeat(padded)}`;
  return `${bg}${content.replaceAll(RESET, `${RESET}${bg}`)}${bg}${" ".repeat(padded)}${RESET}`;
}

function truncateVisible(line: string, targetWidth: number): string {
  let count = 0;
  let i = 0;
  while (i < line.length && count < targetWidth) {
    if (line[i] === "\x1b") {
      const end = line.indexOf("m", i);
      if (end !== -1) { i = end + 1; continue; }
    }
    count++;
    i++;
  }
  return line.slice(0, i) + RESET;
}

export function appendFilePicker(app: AppState, lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
  const picker = app.filePicker!;
  const maxItems = Math.max(1, maxTotal - 4);
  for (const entry of app.buildMenuView(app.getFilePickerEntries(), picker.cursor, maxItems)) {
    if (entry.selectIndex !== undefined) app.registerMenuClickTarget(clickTargets, lines, () => app.selectFileEntry(entry.selectIndex!));
    lines.push(entry.text);
  }
  if (picker.filtered.length === 0) lines.push(` ${DIM}  no matches${RESET}`);
}

export function appendSettingsPicker(app: AppState, lines: string[], _maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
  const picker = app.settingsPicker!;
  lines.push(` ${T()}${BOLD}Settings${RESET}`);
  const filtered = app.getFilteredSettings();
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
  lines.push(` ${T()}${BOLD}${picker.title}${RESET}`);
  const filtered = app.getFilteredItems();
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
  return findCommandMatches(app.input.getText());
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
