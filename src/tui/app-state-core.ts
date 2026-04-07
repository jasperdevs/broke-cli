import { currentTheme } from "../core/themes.js";
import { getSettings, type CavemanLevel, type Mode, type ThinkingLevel } from "../core/config.js";
import { buildSidebarFooter } from "./render/sidebar-view.js";
import { fmtCost, fmtTokens } from "./render/formatting.js";
import { DIM, RESET } from "../utils/ansi.js";
import { MUTED, OK, P, T, TXT } from "./app-shared.js";
import type { ModelOption, UpdateNotice } from "./app-types.js";

type AppState = any;

export function invalidateMsgCache(app: AppState): void {
  app.msgCacheLines = null;
}

export function setModel(app: AppState, provider: string, model: string): void {
  app.providerName = provider;
  if (model.includes("/")) model = model.split("/").pop()!;
  model = model.replace(/-GGUF(:[^\s]*)?/g, "");
  model = model.replace(/:$/, "");
  app.modelName = model;
  app.draw();
}

export function updateUsage(app: AppState, cost: number, inputTokens: number, outputTokens: number): void {
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

export function resetCost(app: AppState): void {
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

export function getLiveInputTokens(app: AppState): number {
  return app.animInputTokens.getInt();
}

export function getLiveOutputTokens(app: AppState): number {
  return app.animOutputTokens.getInt() + (app.isStreaming ? app.animStreamTokens.getInt() : 0);
}

export function getLiveTotalTokens(app: AppState): number {
  return app.getLiveInputTokens() + app.getLiveOutputTokens();
}

export function renderTokenSummaryParts(app: AppState): string[] {
  const total = app.getLiveTotalTokens();
  const parts: string[] = [];
  if (getSettings().showCost) {
    parts.push(app.sessionCost > 0 ? fmtCost(app.animCost.get()) : "local");
  }
  parts.push(`${fmtTokens(total)} total`);
  parts.push(`${fmtTokens(app.getLiveInputTokens())} in`);
  parts.push(`${fmtTokens(app.getLiveOutputTokens())} out`);
  return parts;
}

export function getModeAccent(app: AppState): string {
  return app.mode === "plan" ? P() : T();
}

function shouldHideSidebarFooter(app: AppState): boolean {
  if (app.isStreaming || app.isCompacting) return true;
  if (app.filePicker || app.itemPicker || app.settingsPicker || app.modelPicker || app.treeView) return true;
  if (app.pendingImages?.length > 0) return true;
  if (app.input.getText().length > 0) return true;
  return app.getCommandSuggestionEntries().length > 0;
}

export function renderSidebarFooter(app: AppState): string[] {
  const settings = getSettings();
  if (shouldHideSidebarFooter(app)) return [];
  const width = app.screen.sidebarWidth;
  const statusParts: string[] = [];
  const modeLabel = app.mode === "plan" ? "plan" : "build";
  statusParts.push(modeLabel);
  const thinkLevel = settings.thinkingLevel || (settings.enableThinking ? "low" : "off");
  if (thinkLevel !== "off") statusParts.push(thinkLevel);
  const caveLevel = settings.cavemanLevel ?? "auto";
  if (caveLevel !== "off") statusParts.push(`🪨 ${caveLevel}`);
  return buildSidebarFooter({
    width,
    showTokens: settings.showTokens,
    statusParts,
    tokenParts: app.renderTokenSummaryParts(),
    contextUsed: app.contextLimitTokens > 0 ? app.contextUsed : undefined,
    contextTokens: app.contextLimitTokens > 0 ? fmtTokens(app.contextTokenCount) : undefined,
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

export function clearInterruptPrompt(app: AppState): void {
  app.ctrlCCount = 0;
  app.escPrimed = false;
  app.escAction = null;
  if (app.ctrlCTimeout) clearTimeout(app.ctrlCTimeout);
  if (app.escTimeout) clearTimeout(app.escTimeout);
  app.ctrlCTimeout = null;
  app.escTimeout = null;
}

export function primeCtrlCExit(app: AppState): void {
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

function primeEscapeAction(app: AppState, action: "stop" | "tree"): void {
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

export function primeEscapeAbort(app: AppState): void {
  primeEscapeAction(app, "stop");
}

export function primeEscapeTree(app: AppState): void {
  primeEscapeAction(app, "tree");
}

export function setContextUsage(app: AppState, tokens: number, limit: number): void {
  app.contextTokenCount = tokens;
  app.contextLimitTokens = limit;
  app.contextUsed = limit > 0 ? Math.min(100, (tokens / limit) * 100) : 0;
  app.animContext.set(app.contextUsed);
  if (!app.isStreaming) app.animContext.sync();
  app.draw();
}

export function setStreaming(app: AppState, streaming: boolean): void {
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
      const elapsed = Date.now() - app.streamStartTime;
      const secs = Math.floor(elapsed / 1000);
      const mins = Math.floor(secs / 60);
      const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
      const extras: string[] = [];
      if (app.streamTokens > 0) extras.push(`${fmtTokens(app.streamTokens)} tokens`);
      if (app.thinkingDuration > 0) extras.push(`thought for ${app.thinkingDuration}s`);
      const extraStr = extras.length > 0 ? ` · ${extras.join(" · ")}` : "";
      app.messages.push({ role: "system", content: `${DIM}✦ Churned for ${timeStr}${extraStr}${RESET}` });
      app.invalidateMsgCache();
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
    app.spinnerTimer = setInterval(() => {
      app.spinnerFrame++;
      app.animTokens.tick();
      app.animCost.tick();
      app.animStreamTokens.tick();
      app.animContext.tick();
      app.draw();
    }, app.constructor.ANIMATION_INTERVAL_MS);
  } else if (app.spinnerTimer) {
    clearInterval(app.spinnerTimer);
    app.spinnerTimer = null;
  }
  app.invalidateMsgCache();
  if (streaming) app.drawNow();
  else app.draw();
}

export function setThinkingRequested(app: AppState, requested: boolean): void {
  app.thinkingRequested = requested;
  if (requested && app.isStreaming && app.thinkingStartTime <= 0) app.thinkingStartTime = Date.now();
  if (!requested && !app.thinkingBuffer) app.thinkingStartTime = 0;
  app.draw();
}

export function setDetectedProviders(app: AppState, providers: string[]): void { app.detectedProviders = providers; }
export function setSessionName(app: AppState, name: string): void { app.sessionName = name; }
export function setVersion(app: AppState, v: string): void { app.appVersion = v; }
export function setMcpConnections(app: AppState, conns: string[]): void { app.mcpConnections = conns; }
export function setUpdateNotice(app: AppState, notice: UpdateNotice | null): void {
  app.updateNotice = notice;
  app.draw();
}
export function clearUpdateNotice(app: AppState): void {
  app.updateNotice = null;
  app.draw();
}

export interface AppStateCoreMethods {
  invalidateMsgCache(): void;
  setModel(provider: string, model: string): void;
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
  setDetectedProviders(providers: string[]): void;
  setSessionName(name: string): void;
  setVersion(v: string): void;
  setMcpConnections(conns: string[]): void;
  setUpdateNotice(notice: UpdateNotice | null): void;
  clearUpdateNotice(): void;
}

export const appStateCoreMethods: AppStateCoreMethods = {
  invalidateMsgCache(this: AppState) { return invalidateMsgCache(this); },
  setModel(this: AppState, provider: string, model: string) { return setModel(this, provider, model); },
  updateUsage(this: AppState, cost: number, inputTokens: number, outputTokens: number) { return updateUsage(this, cost, inputTokens, outputTokens); },
  resetCost(this: AppState) { return resetCost(this); },
  getLiveInputTokens(this: AppState) { return getLiveInputTokens(this); },
  getLiveOutputTokens(this: AppState) { return getLiveOutputTokens(this); },
  getLiveTotalTokens(this: AppState) { return getLiveTotalTokens(this); },
  renderTokenSummaryParts(this: AppState) { return renderTokenSummaryParts(this); },
  getModeAccent(this: AppState) { return getModeAccent(this); },
  renderSidebarFooter(this: AppState) { return renderSidebarFooter(this); },
  clearInterruptPrompt(this: AppState) { return clearInterruptPrompt(this); },
  primeCtrlCExit(this: AppState) { return primeCtrlCExit(this); },
  primeEscapeAbort(this: AppState) { return primeEscapeAbort(this); },
  primeEscapeTree(this: AppState) { return primeEscapeTree(this); },
  setContextUsage(this: AppState, tokens: number, limit: number) { return setContextUsage(this, tokens, limit); },
  setStreaming(this: AppState, streaming: boolean) { return setStreaming(this, streaming); },
  setThinkingRequested(this: AppState, requested: boolean) { return setThinkingRequested(this, requested); },
  setDetectedProviders(this: AppState, providers: string[]) { return setDetectedProviders(this, providers); },
  setSessionName(this: AppState, name: string) { return setSessionName(this, name); },
  setVersion(this: AppState, v: string) { return setVersion(this, v); },
  setMcpConnections(this: AppState, conns: string[]) { return setMcpConnections(this, conns); },
  setUpdateNotice(this: AppState, notice: UpdateNotice | null) { return setUpdateNotice(this, notice); },
  clearUpdateNotice(this: AppState) { return clearUpdateNotice(this); },
};
