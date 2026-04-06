import { BOX, BOLD, DIM, RESET } from "../utils/ansi.js";
import { padVisible, visibleWidth } from "../utils/terminal-width.js";
import { currentTheme } from "../core/themes.js";
import { getSettings } from "../core/config.js";
import { renderAnsiColorGrid, parseMascotSvgGrid, resolveMascotPath, type RgbColor } from "./render/mascot.js";
import { renderHomeBox as buildRenderHomeBox, renderHomeView as buildRenderHomeView } from "./render/home.js";
import { renderStaticMessages as buildStaticMessages } from "./render/messages.js";
import { renderToolCallBlock as buildToolCallBlock, renderMessageOverlays } from "./render/chat.js";
import { buildSidebarLines as composeSidebarLines, renderSidebarViewport } from "./render/sidebar-view.js";
import { loadSidebarFileTree } from "./sidebar.js";
import { fmtTokens, wordWrap } from "./render/formatting.js";
import { ACCENT_2, APP_DIR, BORDER, ERR, HOME_TIPS, MUTED, OK, T, TXT, USER_BG, USER_TXT, WARN } from "./app-shared.js";

type AppState = any;

export function isToolOutput(_app: AppState, content: string): boolean {
  return content.startsWith("> ") || content.startsWith("  ");
}

export function renderStaticMessages(app: AppState, maxWidth: number): string[] {
  if (app.msgCacheLines && app.msgCacheWidth === maxWidth && app.msgCacheLen === app.messages.length) return app.msgCacheLines;
  const lines = buildStaticMessages({
    messages: app.messages,
    maxWidth,
    toolOutputCollapsed: app.toolOutputCollapsed,
    isToolOutput: (content) => app.isToolOutput(content),
    wordWrap,
    colors: {
      imageTagBg: currentTheme().imageTagBg,
      userBg: USER_BG(),
      userText: USER_TXT(),
      border: BORDER(),
      muted: MUTED(),
      text: TXT(),
    },
    reset: RESET,
    bold: BOLD,
  });
  app.msgCacheLines = lines;
  app.msgCacheWidth = maxWidth;
  app.msgCacheLen = app.messages.length;
  return lines;
}

export function renderToolCallBlock(app: AppState, tc: typeof app.toolCallGroups[0], maxWidth: number): string[] {
  return buildToolCallBlock({
    tc,
    maxWidth,
    spinnerFrame: app.spinnerFrame,
    colors: {
      error: ERR(),
      ok: OK(),
      accent2: ACCENT_2(),
      muted: DIM,
      text: TXT(),
      diffRemoveBg: currentTheme().diffRemoveBg,
      diffAddBg: currentTheme().diffAddBg,
    },
    reset: RESET,
  });
}

export function renderMessages(app: AppState, maxWidth: number): string[] {
  return renderMessageOverlays({
    staticLines: app.renderStaticMessages(maxWidth),
    maxWidth,
    thinkingBuffer: app.thinkingBuffer,
    thinkingRequested: app.thinkingRequested,
    isStreaming: app.isStreaming,
    todoItems: app.todoItems,
    spinnerFrame: app.spinnerFrame,
    streamStartTime: app.streamStartTime,
    streamTokens: app.animStreamTokens.getInt(),
    thinkingStartTime: app.thinkingStartTime,
    thinkingDuration: app.thinkingDuration,
    isCompacting: app.isCompacting,
    compactStartTime: app.compactStartTime,
    compactTokens: app.compactTokens,
    fmtTokens,
    sparkleSpinner: (frame, color) => app.sparkleSpinner(frame, color),
    shimmerText: (text, frame) => app.shimmerText(text, frame),
    colors: {
      accent: T(),
      ok: OK(),
      warn: WARN(),
      dim: DIM,
      text: TXT(),
      bold: BOLD,
      reset: RESET,
    },
  });
}

export function renderCompactHeader(app: AppState): string {
  const model = `${T()}${app.providerName}/${app.modelName}${RESET}`;
  const git = app.gitBranch ? ` ${MUTED()}${app.gitBranch}${app.gitDirty ? "*" : ""}${RESET}` : "";
  return ` ${model}${git}`;
}

export function shouldShowSidebar(app: AppState): boolean {
  return app.messages.length > 0 && app.screen.hasSidebar && !getSettings().hideSidebar;
}

export function pickHomeTipIndex(app: AppState): number {
  const seed = `${process.cwd()}|${process.platform}|${app.appVersion}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % HOME_TIPS.length;
}

export function refreshHomeScreenData(app: AppState): void {
  app.homeTip = HOME_TIPS[app.pickHomeTipIndex()];
}

export function formatShortCwd(app: AppState, maxWidth: number): string {
  return app.formatShortPath(app.cwd, maxWidth);
}

export function formatShortPath(_app: AppState, pathValue: string, maxWidth: number): string {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  let display = pathValue;
  if (home && display.toLowerCase().startsWith(home.toLowerCase())) {
    display = `~${display.slice(home.length)}`;
    if (display === "~") display = "~/";
  }
  if (maxWidth <= 1) return display.slice(0, Math.max(0, maxWidth));
  if (display.length <= maxWidth) return display;
  return `~${display.slice(-(maxWidth - 1))}`;
}

export function formatRelativeAge(_app: AppState, updatedAt: number): string {
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function resolveMascotPathCached(app: AppState): string | null {
  if (app.mascotPathCache !== undefined) return app.mascotPathCache;
  app.mascotPathCache = resolveMascotPath(process.cwd(), APP_DIR);
  return app.mascotPathCache;
}

export function parseMascotSvgGridCached(app: AppState, path: string): Array<Array<RgbColor | null>> {
  const cached = app.mascotGridCache.get(path);
  if (cached) return cached;
  const cells = parseMascotSvgGrid(path);
  app.mascotGridCache.set(path, cells);
  return cells;
}

export function renderMascotBlock(app: AppState): string[] {
  const path = app.resolveMascotPath();
  if (!path) return [];
  const cached = app.mascotAnsiCache.get(path);
  if (cached) return cached;
  const rendered = renderAnsiColorGrid(app.parseMascotSvgGrid(path), RESET);
  app.mascotAnsiCache.set(path, rendered);
  return rendered;
}

export function renderMascotInline(app: AppState): string[] {
  return app.renderMascotBlock();
}

export function wrapHomeDetail(_app: AppState, label: string, value: string, width: number): string[] {
  const prefix = `${TXT()}${label}${RESET}  `;
  const prefixPlain = `${label}  `;
  const available = Math.max(8, width - prefixPlain.length);
  const wrapped = wordWrap(value, available);
  return wrapped.map((part, index) => index === 0 ? `${prefix}${TXT()}${part}${RESET}` : `${" ".repeat(prefixPlain.length)}${TXT()}${part}${RESET}`);
}

export function wrapHomeText(_app: AppState, prefix: string, prefixPlain: string, value: string, width: number, color = MUTED()): string[] {
  const available = Math.max(6, width - prefixPlain.length);
  const wrapped = wordWrap(value, available);
  return wrapped.map((part, index) => index === 0 ? `${prefix}${color}${part}${RESET}` : `${" ".repeat(prefixPlain.length)}${color}${part}${RESET}`);
}

export function centerVisibleLine(_app: AppState, line: string, width: number): string {
  const visible = visibleWidth(line);
  if (visible >= width) return line;
  const left = Math.floor((width - visible) / 2);
  return `${" ".repeat(left)}${line}`;
}

export function renderHomeBox(app: AppState, width: number, title: string, body: string[]): string[] {
  return buildRenderHomeBox({
    width,
    title,
    body,
    box: BOX,
    frameColor: MUTED(),
    reset: RESET,
    padLine: (line, innerWidth) => app.padLine(line, innerWidth),
  });
}

export function renderHomeView(app: AppState, mainW: number, topHeight: number): string[] {
  return buildRenderHomeView({
    mainW,
    topHeight,
    fullMascot: app.renderMascotInline(),
    modelLabel: app.modelName === "none" ? "Pick one with /model" : `${app.providerName}/${app.modelName}`,
    appVersion: app.appVersion,
    homeTip: app.homeTip,
    formatShortCwd: (maxWidth) => app.formatShortCwd(maxWidth),
    wrapHomeDetail: (label, value, width) => app.wrapHomeDetail(label, value, width),
    renderHomeBox: (width, title, body) => app.renderHomeBox(width, title, body),
    titleColor: T(),
    textColor: TXT(),
    bold: BOLD,
    reset: RESET,
  });
}

export function buildSidebarLines(app: AppState): string[] {
  if (app.sidebarTreeOpen && !app.sidebarFileTree) app.sidebarFileTree = loadSidebarFileTree(app.cwd);
  return composeSidebarLines({
    width: app.screen.sidebarWidth,
    sessionName: app.sessionName,
    appVersion: app.appVersion,
    providerName: app.providerName,
    modelName: app.modelName,
    detectedProviders: app.detectedProviders,
    mcpConnections: app.mcpConnections,
    shortCwd: app.formatShortCwd(Math.max(4, app.screen.sidebarWidth - 2)),
    gitBranch: app.gitBranch,
    gitDirty: app.gitDirty,
    sidebarTreeOpen: app.sidebarTreeOpen,
    sidebarFileTree: app.sidebarFileTree,
    sidebarExpandedDirs: app.sidebarExpandedDirs,
    colors: {
      text: TXT(),
      muted: MUTED(),
      accent: T(),
      success: currentTheme().success,
      bold: BOLD,
      reset: RESET,
    },
  });
}

export function renderSidebar(app: AppState, visibleHeight: number): string[] {
  const viewport = renderSidebarViewport({
    allLines: app.buildSidebarLines(),
    visibleHeight,
    sidebarScrollOffset: app.sidebarScrollOffset,
    sidebarFocused: app.sidebarFocused,
    muted: DIM,
    reset: RESET,
  });
  app.sidebarScrollOffset = viewport.scrollOffset;
  return viewport.lines;
}

export function padLine(_app: AppState, line: string, targetWidth: number): string {
  const padded = padVisible(line, targetWidth);
  return padded === line ? line : `${padded}${RESET}`;
}
