import { currentTheme } from "../core/themes.js";
import { getSettings, type CavemanLevel, type Mode, type ThinkingLevel } from "../core/config.js";
import { getEffectiveThinkingLevel } from "../ai/thinking.js";
import { buildSidebarFooter } from "./render/sidebar-view.js";
import { fmtCost, fmtTokens } from "./render/formatting.js";
import { DIM, setWindowTitle } from "../utils/ansi.js";
import { MUTED, OK, P, T, TXT } from "./app-shared.js";
import type { BtwBubble, ChatMessage, ModelOption, UpdateNotice } from "./app-types.js";
import type { ModelRuntime } from "../ai/providers.js";

interface AnimatedValueLike {
  tick(): void;
  set(value: number): void;
  sync(): void;
  reset(): void;
  get(): number;
  getInt(): number;
}

interface CoreAppState {
  constructor: { ANIMATION_INTERVAL_MS: number };
  sessionName?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  btwBubble?: BtwBubble | null;
  spinnerFrame: number;
  spinnerTimer: ReturnType<typeof setInterval> | null;
  animTokens: AnimatedValueLike;
  animCost: AnimatedValueLike;
  animStreamTokens: AnimatedValueLike;
  animContext: AnimatedValueLike;
  animInputTokens: AnimatedValueLike;
  animOutputTokens: AnimatedValueLike;
  draw(): void;
  drawNow(): void;
  providerName: string;
  modelProviderId?: string;
  modelRuntime?: ModelRuntime;
  modelName: string;
  sessionCost: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionTokens: number;
  contextUsed: number;
  contextTokenCount: number;
  contextLimitTokens: number;
  mode: Mode;
  screen: { sidebarWidth: number };
  ctrlCCount: number;
  escPrimed: boolean;
  escAction: "stop" | "tree" | null;
  ctrlCTimeout: ReturnType<typeof setTimeout> | null;
  escTimeout: ReturnType<typeof setTimeout> | null;
  streamStartTime: number;
  streamTokens: number;
  thinkingRequested: boolean;
  thinkingStartTime: number;
  thinkingDuration: number;
  thinkingBuffer: string;
  toolCallGroups: unknown[];
  messages: ChatMessage[];
  msgCacheLines: string[] | null;
  detectedProviders: string[];
  appVersion: string;
  mcpConnections: string[];
  updateNotice: UpdateNotice | null;
  invalidateMsgCache(): void;
  collapseToolCalls(): void;
  ensureUiSpinner(): void;
  releaseUiSpinnerIfIdle(): void;
  getLiveInputTokens(): number;
  getLiveOutputTokens(): number;
  getLiveTotalTokens(): number;
  renderTokenSummaryParts(): string[];
  getModeAccent(): string;
}

const WINDOW_TITLE_SPINNER = ["·", "✧", "✦", "✧"];

function formatWindowTitle(app: CoreAppState): string {
  const baseName = (app.sessionName?.trim?.() || "broke-cli").replace(/\s+/g, " ").trim();
  if (!app.isStreaming && !app.isCompacting && !app.btwBubble?.pending) return baseName;
  const spinner = WINDOW_TITLE_SPINNER[app.spinnerFrame % WINDOW_TITLE_SPINNER.length] ?? WINDOW_TITLE_SPINNER[0];
  return `${spinner} ${baseName}`;
}

export function refreshWindowTitle(app: CoreAppState): void {
  setWindowTitle(formatWindowTitle(app));
}

export function ensureUiSpinner(app: CoreAppState): void {
  if (app.spinnerTimer) return;
  app.spinnerTimer = setInterval(() => {
    app.spinnerFrame++;
    app.animTokens.tick();
    app.animCost.tick();
    app.animStreamTokens.tick();
    app.animContext.tick();
    refreshWindowTitle(app);
    app.draw();
  }, app.constructor.ANIMATION_INTERVAL_MS);
}

export function releaseUiSpinnerIfIdle(app: CoreAppState): void {
  if (app.isStreaming || app.isCompacting || app.btwBubble?.pending) return;
  if (!app.spinnerTimer) return;
  clearInterval(app.spinnerTimer);
  app.spinnerTimer = null;
}

export function invalidateMsgCache(app: CoreAppState): void {
  app.msgCacheLines = null;
}

export function setModel(app: CoreAppState, provider: string, model: string, meta?: { providerId?: string; runtime?: ModelRuntime }): void {
  app.providerName = provider;
  if (meta?.providerId) app.modelProviderId = meta.providerId;
  if (meta?.runtime) app.modelRuntime = meta.runtime;
  if (model.includes("/")) model = model.split("/").pop()!;
  model = model.replace(/-GGUF(:[^\s]*)?/g, "");
  model = model.replace(/:$/, "");
  app.modelName = model;
  app.draw();
}

export function updateUsage(app: CoreAppState, cost: number, inputTokens: number, outputTokens: number): void {
  app.sessionCost = cost;
  app.sessionInputTokens = inputTokens;
  app.sessionOutputTokens = outputTokens;
  app.sessionTokens = inputTokens + outputTokens;
  app.animCost.set(cost);
  app.animInputTokens.set(inputTokens);
  app.animOutputTokens.set(outputTokens);
  app.animTokens.set(app.sessionTokens);
  if (!app.isStreaming) {
    app.animCost.sync();
    app.animInputTokens.sync();
    app.animOutputTokens.sync();
    app.animTokens.sync();
  }
  app.draw();
}

export function resetCost(app: CoreAppState): void {
  app.sessionCost = 0;
  app.sessionInputTokens = 0;
  app.sessionOutputTokens = 0;
  app.sessionTokens = 0;
  app.contextUsed = 0;
  app.contextTokenCount = 0;
  app.contextLimitTokens = 0;
  app.animCost.reset();
  app.animInputTokens.reset();
  app.animOutputTokens.reset();
  app.animTokens.reset();
  app.animStreamTokens.reset();
  app.animContext.reset();
  app.draw();
}

export function getLiveInputTokens(app: CoreAppState): number {
  return app.animInputTokens.getInt();
}

export function getLiveOutputTokens(app: CoreAppState): number {
  return app.animOutputTokens.getInt() + (app.isStreaming ? app.animStreamTokens.getInt() : 0);
}

export function getLiveTotalTokens(app: CoreAppState): number {
  return app.getLiveInputTokens() + app.getLiveOutputTokens();
}

export function renderTokenSummaryParts(app: CoreAppState): string[] {
  const total = app.getLiveTotalTokens();
  const parts: string[] = [];
  if (getSettings().showCost) {
    parts.push(app.sessionCost > 0 ? fmtCost(app.animCost.get()) : "local/unpriced");
  }
  parts.push(`${fmtTokens(total)} total`);
  parts.push(`${fmtTokens(app.getLiveInputTokens())} in`);
  parts.push(`${fmtTokens(app.getLiveOutputTokens())} out`);
  return parts;
}

export function getModeAccent(app: CoreAppState): string {
  return app.mode === "plan" ? P() : T();
}

function shouldHideSidebarFooter(app: CoreAppState): boolean {
  void app;
  return false;
}

export function renderSidebarFooter(app: CoreAppState): string[] {
  const settings = getSettings();
  if (shouldHideSidebarFooter(app)) return [];
  const width = app.screen.sidebarWidth;
  const statusParts: string[] = [];
  const modeLabel = app.mode === "plan" ? "plan" : "build";
  statusParts.push(modeLabel);
  const thinkLevel = getEffectiveThinkingLevel({
    providerId: app.modelProviderId,
    modelId: app.modelName === "none" ? undefined : app.modelName,
    runtime: app.modelRuntime,
    level: settings.thinkingLevel,
    enabled: settings.enableThinking,
  });
  if (thinkLevel !== "off") statusParts.push(thinkLevel);
  const caveLevel = settings.cavemanLevel ?? "auto";
  if (caveLevel !== "off") statusParts.push(`🪨 ${caveLevel}`);
  return buildSidebarFooter({
    width,
    showTokens: settings.showTokens,
    statusParts,
    tokenParts: app.renderTokenSummaryParts(),
    contextUsed: app.contextLimitTokens > 0 && app.contextTokenCount >= 0 ? app.contextUsed : undefined,
    contextTokens: app.contextLimitTokens > 0
      ? `${app.contextTokenCount >= 0 ? fmtTokens(app.contextTokenCount) : "?"}/${fmtTokens(app.contextLimitTokens)}`
      : undefined,
    colors: {
      accent: app.getModeAccent(),
      muted: MUTED(),
      dim: DIM,
      text: TXT(),
      warning: currentTheme().warning,
      error: currentTheme().error,
    },
  });
}

export function clearInterruptPrompt(app: CoreAppState): void {
  app.ctrlCCount = 0;
  app.escPrimed = false;
  app.escAction = null;
  if (app.ctrlCTimeout) clearTimeout(app.ctrlCTimeout);
  if (app.escTimeout) clearTimeout(app.escTimeout);
  app.ctrlCTimeout = null;
  app.escTimeout = null;
}

export function primeCtrlCExit(app: CoreAppState): void {
  app.escPrimed = false;
  app.escAction = null;
  app.ctrlCCount = 1;
  if (app.ctrlCTimeout) clearTimeout(app.ctrlCTimeout);
  app.ctrlCTimeout = setTimeout(() => {
    app.ctrlCCount = 0;
    app.ctrlCTimeout = null;
    app.draw();
  }, 1500);
  app.draw();
}

function primeEscapeAction(app: CoreAppState, action: "stop" | "tree"): void {
  app.ctrlCCount = 0;
  app.escPrimed = true;
  app.escAction = action;
  if (app.escTimeout) clearTimeout(app.escTimeout);
  app.escTimeout = setTimeout(() => {
    app.escPrimed = false;
    app.escAction = null;
    app.escTimeout = null;
    app.draw();
  }, 1500);
  app.drawNow?.();
}

export function primeEscapeAbort(app: CoreAppState): void {
  primeEscapeAction(app, "stop");
}

export function primeEscapeTree(app: CoreAppState): void {
  primeEscapeAction(app, "tree");
}

export function setContextUsage(app: CoreAppState, tokens: number, limit: number): void {
  app.contextTokenCount = tokens;
  app.contextLimitTokens = limit;
  app.contextUsed = limit > 0 && tokens >= 0 ? Math.min(100, (tokens / limit) * 100) : 0;
  app.animContext.set(app.contextUsed);
  if (!app.isStreaming && tokens >= 0) app.animContext.sync();
  app.draw();
}

export function setStreaming(app: CoreAppState, streaming: boolean): void {
  app.isStreaming = streaming;
  if (!streaming) {
    app.thinkingRequested = false;
    if (app.thinkingStartTime > 0) {
      app.thinkingDuration = Math.floor((Date.now() - app.thinkingStartTime) / 1000);
      app.thinkingStartTime = 0;
    } else {
      app.thinkingDuration = 0;
    }
    if (app.toolCallGroups.length > 0) app.collapseToolCalls();
    if (app.streamStartTime > 0) {
      app.streamStartTime = 0;
    }
    app.animStreamTokens.reset();
  }
  if (streaming) {
    app.thinkingBuffer = "";
    app.thinkingStartTime = 0;
    app.thinkingDuration = 0;
    app.spinnerFrame = 0;
    app.streamStartTime = Date.now();
    app.streamTokens = 0;
    app.animStreamTokens.reset();
    app.toolCallGroups = [];
    app.ensureUiSpinner();
  } else {
    app.releaseUiSpinnerIfIdle();
  }
  refreshWindowTitle(app);
  app.invalidateMsgCache();
  if (streaming) app.drawNow();
  else app.draw();
}

export function setThinkingRequested(app: CoreAppState, requested: boolean): void {
  app.thinkingRequested = requested;
  if (requested && app.isStreaming && app.thinkingStartTime <= 0) app.thinkingStartTime = Date.now();
  if (!requested && !app.thinkingBuffer) app.thinkingStartTime = 0;
  app.draw();
}

export function setDetectedProviders(app: CoreAppState, providers: string[]): void { app.detectedProviders = providers; }
export function setSessionName(app: CoreAppState, name: string): void {
  app.sessionName = name;
  refreshWindowTitle(app);
}
export function setVersion(app: CoreAppState, v: string): void { app.appVersion = v; }
export function setMcpConnections(app: CoreAppState, conns: string[]): void { app.mcpConnections = conns; }
export function setUpdateNotice(app: CoreAppState, notice: UpdateNotice | null): void {
  app.updateNotice = notice;
  app.draw();
}
export function clearUpdateNotice(app: CoreAppState): void {
  app.updateNotice = null;
  app.draw();
}

export interface AppStateCoreMethods {
  invalidateMsgCache(): void;
  setModel(provider: string, model: string, meta?: { providerId?: string; runtime?: ModelRuntime }): void;
  updateUsage(cost: number, inputTokens: number, outputTokens: number): void;
  resetCost(): void;
  getLiveInputTokens(): number;
  getLiveOutputTokens(): number;
  getLiveTotalTokens(): number;
  renderTokenSummaryParts(): string[];
  getModeAccent(): string;
  renderSidebarFooter(): string[];
  clearInterruptPrompt(): void;
  primeCtrlCExit(): void;
  primeEscapeAbort(): void;
  primeEscapeTree(): void;
  setContextUsage(tokens: number, limit: number): void;
  setStreaming(streaming: boolean): void;
  setThinkingRequested(requested: boolean): void;
  refreshWindowTitle(): void;
  ensureUiSpinner(): void;
  releaseUiSpinnerIfIdle(): void;
  setDetectedProviders(providers: string[]): void;
  setSessionName(name: string): void;
  setVersion(v: string): void;
  setMcpConnections(conns: string[]): void;
  setUpdateNotice(notice: UpdateNotice | null): void;
  clearUpdateNotice(): void;
}

export const appStateCoreMethods: AppStateCoreMethods = {
  invalidateMsgCache(this: CoreAppState) { return invalidateMsgCache(this); },
  setModel(this: CoreAppState, provider: string, model: string, meta?: { providerId?: string; runtime?: ModelRuntime }) { return setModel(this, provider, model, meta); },
  updateUsage(this: CoreAppState, cost: number, inputTokens: number, outputTokens: number) { return updateUsage(this, cost, inputTokens, outputTokens); },
  resetCost(this: CoreAppState) { return resetCost(this); },
  getLiveInputTokens(this: CoreAppState) { return getLiveInputTokens(this); },
  getLiveOutputTokens(this: CoreAppState) { return getLiveOutputTokens(this); },
  getLiveTotalTokens(this: CoreAppState) { return getLiveTotalTokens(this); },
  renderTokenSummaryParts(this: CoreAppState) { return renderTokenSummaryParts(this); },
  getModeAccent(this: CoreAppState) { return getModeAccent(this); },
  renderSidebarFooter(this: CoreAppState) { return renderSidebarFooter(this); },
  clearInterruptPrompt(this: CoreAppState) { return clearInterruptPrompt(this); },
  primeCtrlCExit(this: CoreAppState) { return primeCtrlCExit(this); },
  primeEscapeAbort(this: CoreAppState) { return primeEscapeAbort(this); },
  primeEscapeTree(this: CoreAppState) { return primeEscapeTree(this); },
  setContextUsage(this: CoreAppState, tokens: number, limit: number) { return setContextUsage(this, tokens, limit); },
  setStreaming(this: CoreAppState, streaming: boolean) { return setStreaming(this, streaming); },
  setThinkingRequested(this: CoreAppState, requested: boolean) { return setThinkingRequested(this, requested); },
  refreshWindowTitle(this: CoreAppState) { return refreshWindowTitle(this); },
  ensureUiSpinner(this: CoreAppState) { return ensureUiSpinner(this); },
  releaseUiSpinnerIfIdle(this: CoreAppState) { return releaseUiSpinnerIfIdle(this); },
  setDetectedProviders(this: CoreAppState, providers: string[]) { return setDetectedProviders(this, providers); },
  setSessionName(this: CoreAppState, name: string) { return setSessionName(this, name); },
  setVersion(this: CoreAppState, v: string) { return setVersion(this, v); },
  setMcpConnections(this: CoreAppState, conns: string[]) { return setMcpConnections(this, conns); },
  setUpdateNotice(this: CoreAppState, notice: UpdateNotice | null) { return setUpdateNotice(this, notice); },
  clearUpdateNotice(this: CoreAppState) { return clearUpdateNotice(this); },
};
