import { randomUUID } from "crypto";
import type { ActivityStep, PendingDelivery, PendingImage, PendingMessage, ResolvedImage, TodoItem, ToolExecutionActivity } from "./app-types.js";
import { buildActivityLabel, cloneActivityStep, cloneToolExecution, deriveLiveActivityStep } from "./live-activity.js";

type AppState = any;

function setCurrentActivityFromTool(app: AppState, name: string, preview: string, startedAt?: number): void {
  const label = buildActivityLabel(name, preview);
  if (!label) return;
  void startedAt;
  if (!app.streamingActivitySummary?.trim()) app.streamingActivitySummary = label;
}

function findToolExecutionIndex(app: AppState, name: string, callId?: string): number {
  if (callId) {
    for (let i = app.toolExecutions.length - 1; i >= 0; i--) {
      if (app.toolExecutions[i].callId === callId) return i;
    }
  }
  const normalized = name === "Read" ? "readFile" : name === "Write" ? "writeFile" : name === "Edit" ? "editFile" : name === "LS" ? "listFiles" : name === "Glob" ? "glob" : name;
  for (let i = app.toolExecutions.length - 1; i >= 0; i--) {
    const tc = app.toolExecutions[i];
    const toolName = tc.name === "Read" ? "readFile" : tc.name === "Write" ? "writeFile" : tc.name === "Edit" ? "editFile" : tc.name === "LS" ? "listFiles" : tc.name === "Glob" ? "glob" : tc.name;
    if (toolName === normalized && !tc.result) return i;
  }
  return -1;
}

export function clearMessages(app: AppState): void {
  app.messages = [];
  app.currentActivityStep = null;
  app.toolExecutions = [];
  app.streamingActivitySummary = "";
  app.scrollOffset = 0;
  app.transcriptAutoFollow = true;
  app.composerScrollOffset = 0;
  app.refreshHomeScreenData();
  app.invalidateMsgCache();
  app.screen.forceRedraw([]);
  app.draw();
}

function followTranscriptIfAnchored(app: AppState): void {
  if (app.transcriptAutoFollow) app.scrollToBottom();
}

function findLastAssistantMessage(app: AppState): any | null {
  for (let i = app.messages.length - 1; i >= 0; i--) {
    const message = app.messages[i];
    if (message?.role === "assistant") return message;
  }
  return null;
}

function persistCurrentActivityToLastAssistant(app: AppState): void {
  const step = deriveLiveActivityStep(app);
  if (!step && app.toolExecutions.length === 0) return;
  let last = findLastAssistantMessage(app);
  if (!last) {
    last = { role: "assistant", content: "" };
    app.messages.push(last);
  }
  last.activity = {
    step: cloneActivityStep(step),
    tools: app.toolExecutions.map(cloneToolExecution),
  };
  app.invalidateMsgCache();
}

export function setDraft(app: AppState, text: string): void {
  app.input.setText(text);
  app.composerScrollOffset = 0;
  app.drawNow();
}

export function appendDraft(app: AppState, text: string): void {
  const insertion = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!insertion) return;
  const current = app.input.getText();
  const joiner = !current
    ? ""
    : current.endsWith("\n\n") || insertion.startsWith("\n")
      ? ""
      : current.endsWith("\n")
        ? "\n"
        : "\n\n";
  app.input.setText(`${current}${joiner}${insertion}`);
  app.drawNow();
}

export function getDraft(app: AppState): string {
  return app.input.getText();
}

export function dismissPassiveBtwBubble(app: AppState): boolean {
  if (!app.btwBubble || app.btwBubble.pending) return false;
  app.dismissBtwBubble();
  return true;
}

export function clearComposerViewport(app: AppState): void {
  app.composerScrollOffset = 0;
  app.drawNow();
}

export function addMessage(app: AppState, role: "user" | "assistant" | "system", content: string, images?: ResolvedImage[]): void {
  if (role === "user") {
    persistCurrentActivityToLastAssistant(app);
  }
  if (role === "user") {
    app.thinkingBuffer = "";
    app.thinkingStartTime = 0;
    app.thinkingDuration = 0;
    app.currentActivityStep = null;
    app.toolExecutions = [];
    app.streamingActivitySummary = "";
  }
  app.messages.push({ role, content, images });
  if (role === "assistant") {
    persistCurrentActivityToLastAssistant(app);
  }
  app.invalidateMsgCache();
  followTranscriptIfAnchored(app);
  app.draw();
}

export function appendToLastMessage(app: AppState, text: string): void {
  if (app.thinkingStartTime > 0 && app.thinkingBuffer) {
    app.thinkingDuration = Math.floor((Date.now() - app.thinkingStartTime) / 1000);
    app.thinkingStartTime = 0;
    const last = app.messages[app.messages.length - 1];
    if (last?.role === "assistant") last.thinkingDuration = app.thinkingDuration;
  }
  const last = app.messages[app.messages.length - 1];
  if (last && last.role === "assistant") last.content += text;
  else app.messages.push({ role: "assistant", content: text });
  if (!app.isStreaming) persistCurrentActivityToLastAssistant(app);
  app.invalidateMsgCache();
  followTranscriptIfAnchored(app);
  app.draw();
}

export function replaceLastAssistantMessage(app: AppState, text: string): void {
  const last = app.messages[app.messages.length - 1];
  if (last && last.role === "assistant") last.content = text;
  else app.messages.push({ role: "assistant", content: text });
  app.invalidateMsgCache();
  followTranscriptIfAnchored(app);
  app.draw();
}

export function appendThinking(app: AppState, delta: string): void {
  if (!app.thinkingBuffer && delta) app.thinkingStartTime = Date.now();
  app.thinkingBuffer += delta;
  let last = app.messages[app.messages.length - 1];
  if (!last || last.role !== "assistant") {
    last = { role: "assistant", content: "" };
    app.messages.push(last);
  }
  last.thinking = `${last.thinking ?? ""}${delta}`;
  app.invalidateMsgCache();
  followTranscriptIfAnchored(app);
  app.draw();
}

export function updateTodo(app: AppState, items: TodoItem[]): void {
  app.todoItems = items;
  app.invalidateMsgCache();
  app.draw();
}

export function addToolCall(app: AppState, name: string, preview: string, args?: unknown, callId?: string): void {
  app.toolExecutions.push({
    id: randomUUID(),
    callId,
    name,
    preview,
    args,
    expanded: app.allToolsExpanded,
    startedAt: Date.now(),
    status: "starting",
  });
  setCurrentActivityFromTool(app, name, preview);
  app.invalidateMsgCache();
  followTranscriptIfAnchored(app);
  app.drawNow();
}

export function updateToolCallArgs(app: AppState, name: string, preview: string, args: unknown, callId?: string): void {
  const index = findToolExecutionIndex(app, name, callId);
  if (index >= 0) {
    const tc = app.toolExecutions[index];
    tc.preview = preview;
    tc.args = args;
    tc.status = "running";
    setCurrentActivityFromTool(app, tc.name, tc.preview, tc.startedAt);
    app.invalidateMsgCache();
    app.drawNow();
    return;
  }
  app.addToolCall(name, preview, args, callId);
}

export function addToolResult(app: AppState, name: string, result: string, error?: boolean, resultDetail?: string, callId?: string): void {
  const index = findToolExecutionIndex(app, name, callId);
  if (index >= 0) {
    app.toolExecutions[index].result = result;
    app.toolExecutions[index].error = error;
    app.toolExecutions[index].resultDetail = resultDetail;
    app.toolExecutions[index].completedAt = Date.now();
    app.toolExecutions[index].status = error ? "failed" : "done";
    const hasRunning = app.toolExecutions.some((tc: any) => tc.status === "starting" || tc.status === "running");
    if (!hasRunning && !app.isStreaming && !app.isCompacting) app.streamingActivitySummary = "";
  }
  app.invalidateMsgCache();
  followTranscriptIfAnchored(app);
  app.drawNow();
}

export function setStreamTokens(app: AppState, tokens: number): void {
  app.streamTokens = tokens;
  app.animStreamTokens.set(tokens);
  if (!app.isStreaming) app.animStreamTokens.sync();
}

export function setCompacting(app: AppState, compacting: boolean, tokenCount?: number): void {
  app.isCompacting = compacting;
  if (compacting) {
    app.compactStartTime = Date.now();
    app.compactTokens = tokenCount ?? 0;
    app.invalidateMsgCache();
    followTranscriptIfAnchored(app);
    app.ensureUiSpinner();
  } else if (!app.isStreaming) {
    app.releaseUiSpinnerIfIdle();
  }
  app.refreshWindowTitle?.();
  app.draw();
}

export function appendToolOutput(app: AppState, chunk: string): void {
  for (let i = app.toolExecutions.length - 1; i >= 0; i--) {
    const tc = app.toolExecutions[i];
    if (tc.name === "bash" && !tc.result) {
      tc.streamOutput = (tc.streamOutput ?? "") + chunk;
      tc.status = "running";
      setCurrentActivityFromTool(app, tc.name, tc.preview, tc.startedAt);
      app.invalidateMsgCache();
      followTranscriptIfAnchored(app);
      app.drawNow();
      return;
    }
  }
}

export function collapseToolCalls(app: AppState): void { app.toolExecutions = []; }

export function getLastAssistantContent(app: AppState): string {
  for (let i = app.messages.length - 1; i >= 0; i--) {
    if (app.messages[i].role === "assistant") return app.messages[i].content;
  }
  return "";
}

export function rollbackLastAssistantMessage(app: AppState): void {
  for (let i = app.messages.length - 1; i >= 0; i--) {
    if (app.messages[i]?.role !== "assistant") continue;
    app.messages.splice(i, 1);
    app.invalidateMsgCache();
    app.draw();
    return;
  }
}

export function getFileContexts(app: AppState): Map<string, string> {
  const ctx = new Map<string, string>(app.fileContexts);
  app.fileContexts.clear();
  return ctx;
}

export function setStatus(app: AppState, message: string): void {
  if (app.statusTimer) {
    clearTimeout(app.statusTimer);
    app.statusTimer = null;
  }
  app.statusMessage = message;
  app.statusTimer = setTimeout(() => {
    if (app.statusMessage === message) {
      app.statusMessage = undefined;
      app.draw();
    }
    app.statusTimer = null;
  }, 4000);
  app.draw();
}

export function clearStatus(app: AppState): void {
  if (app.statusTimer) {
    clearTimeout(app.statusTimer);
    app.statusTimer = null;
  }
  app.statusMessage = undefined;
  app.draw();
}

export function onInput(app: AppState, handler: (text: string, images?: ResolvedImage[]) => void): void {
  app.onSubmit = handler as (text: string) => void;
}

export function onPendingMessagesReadyHandler(app: AppState, handler: (delivery: PendingDelivery) => void): void {
  app.onPendingMessagesReady = handler;
}

export function takePendingImages(app: AppState): PendingImage[] {
  const images = app.pendingImages;
  app.pendingImages = [];
  return images;
}

export function addPendingMessage(app: AppState, text: string, images?: ResolvedImage[], delivery: PendingDelivery = "followup"): void {
  app.pendingMessages.push({ text, images, delivery });
  app.draw();
}

export function takePendingMessages(app: AppState, delivery?: PendingDelivery): PendingMessage[] {
  if (!delivery) {
    const messages = app.pendingMessages;
    app.pendingMessages = [];
    return messages;
  }
  const messages = app.pendingMessages.filter((entry: PendingMessage) => entry.delivery === delivery);
  app.pendingMessages = app.pendingMessages.filter((entry: PendingMessage) => entry.delivery !== delivery);
  return messages;
}

export function takeLastPendingMessage(app: AppState): PendingMessage | undefined {
  if (app.pendingMessages.length === 0) return undefined;
  return app.pendingMessages.pop();
}

export function clearPendingMessages(app: AppState, delivery?: PendingDelivery): void {
  if (!delivery) app.pendingMessages = [];
  else app.pendingMessages = app.pendingMessages.filter((entry: PendingMessage) => entry.delivery !== delivery);
  app.draw();
}

export function hasPendingMessages(app: AppState, delivery?: PendingDelivery): boolean {
  return delivery ? app.pendingMessages.some((entry: PendingMessage) => entry.delivery === delivery) : app.pendingMessages.length > 0;
}

export function getPendingMessagesCount(app: AppState, delivery?: PendingDelivery): number {
  return delivery ? app.pendingMessages.filter((entry: PendingMessage) => entry.delivery === delivery).length : app.pendingMessages.length;
}

export function flushPendingMessages(app: AppState, delivery: PendingDelivery): void {
  if (app.onPendingMessagesReady) app.onPendingMessagesReady(delivery);
}

export function onAbortRequest(app: AppState, handler: () => void): void { app.onAbort = handler; }

export interface AppStateMessageMethods {
  clearMessages(): void;
  deriveLiveActivityStep(): ActivityStep | null;
  persistCurrentActivityToLastAssistant(): void;
  setDraft(text: string): void;
  appendDraft(text: string): void;
  getDraft(): string;
  addMessage(role: "user" | "assistant" | "system", content: string, images?: ResolvedImage[]): void;
  appendToLastMessage(text: string): void;
  replaceLastAssistantMessage(text: string): void;
  appendThinking(delta: string): void;
  updateTodo(items: TodoItem[]): void;
  addToolCall(name: string, preview: string, args?: unknown, callId?: string): void;
  updateToolCallArgs(name: string, preview: string, args: unknown, callId?: string): void;
  addToolResult(name: string, result: string, error?: boolean, resultDetail?: string, callId?: string): void;
  setStreamTokens(tokens: number): void;
  setCompacting(compacting: boolean, tokenCount?: number): void;
  appendToolOutput(chunk: string): void;
  collapseToolCalls(): void;
  getLastAssistantContent(): string;
  rollbackLastAssistantMessage(): void;
  getFileContexts(): Map<string, string>;
  setStatus(message: string): void;
  clearStatus(): void;
  onInput(handler: (text: string, images?: ResolvedImage[]) => void): void;
  onPendingMessagesReadyHandler(handler: (delivery: PendingDelivery) => void): void;
  takePendingImages(): PendingImage[];
  addPendingMessage(text: string, images?: ResolvedImage[], delivery?: PendingDelivery): void;
  takePendingMessages(delivery?: PendingDelivery): PendingMessage[];
  takeLastPendingMessage(): PendingMessage | undefined;
  clearPendingMessages(delivery?: PendingDelivery): void;
  hasPendingMessages(delivery?: PendingDelivery): boolean;
  getPendingMessagesCount(delivery?: PendingDelivery): number;
  flushPendingMessages(delivery: PendingDelivery): void;
  onAbortRequest(handler: () => void): void;
  dismissPassiveBtwBubble(): boolean;
  clearComposerViewport(): void;
}

export const appStateMessageMethods: AppStateMessageMethods = {
  clearMessages(this: AppState) { return clearMessages(this); },
  deriveLiveActivityStep(this: AppState) { return deriveLiveActivityStep(this); },
  persistCurrentActivityToLastAssistant(this: AppState) { return persistCurrentActivityToLastAssistant(this); },
  setDraft(this: AppState, text) { return setDraft(this, text); },
  appendDraft(this: AppState, text) { return appendDraft(this, text); },
  getDraft(this: AppState) { return getDraft(this); },
  addMessage(this: AppState, role, content, images) { return addMessage(this, role, content, images); },
  appendToLastMessage(this: AppState, text) { return appendToLastMessage(this, text); },
  replaceLastAssistantMessage(this: AppState, text) { return replaceLastAssistantMessage(this, text); },
  appendThinking(this: AppState, delta) { return appendThinking(this, delta); },
  updateTodo(this: AppState, items) { return updateTodo(this, items); },
  addToolCall(this: AppState, name, preview, args, callId) { return addToolCall(this, name, preview, args, callId); },
  updateToolCallArgs(this: AppState, name, preview, args, callId) { return updateToolCallArgs(this, name, preview, args, callId); },
  addToolResult(this: AppState, name, result, error, resultDetail, callId) { return addToolResult(this, name, result, error, resultDetail, callId); },
  setStreamTokens(this: AppState, tokens) { return setStreamTokens(this, tokens); },
  setCompacting(this: AppState, compacting, tokenCount) { return setCompacting(this, compacting, tokenCount); },
  appendToolOutput(this: AppState, chunk) { return appendToolOutput(this, chunk); },
  collapseToolCalls(this: AppState) { return collapseToolCalls(this); },
  getLastAssistantContent(this: AppState) { return getLastAssistantContent(this); },
  rollbackLastAssistantMessage(this: AppState) { return rollbackLastAssistantMessage(this); },
  getFileContexts(this: AppState) { return getFileContexts(this); },
  setStatus(this: AppState, message) { return setStatus(this, message); },
  clearStatus(this: AppState) { return clearStatus(this); },
  onInput(this: AppState, handler) { return onInput(this, handler); },
  onPendingMessagesReadyHandler(this: AppState, handler) { return onPendingMessagesReadyHandler(this, handler); },
  takePendingImages(this: AppState) { return takePendingImages(this); },
  addPendingMessage(this: AppState, text, images, delivery) { return addPendingMessage(this, text, images, delivery); },
  takePendingMessages(this: AppState, delivery) { return takePendingMessages(this, delivery); },
  takeLastPendingMessage(this: AppState) { return takeLastPendingMessage(this); },
  clearPendingMessages(this: AppState, delivery) { return clearPendingMessages(this, delivery); },
  hasPendingMessages(this: AppState, delivery) { return hasPendingMessages(this, delivery); },
  getPendingMessagesCount(this: AppState, delivery) { return getPendingMessagesCount(this, delivery); },
  flushPendingMessages(this: AppState, delivery) { return flushPendingMessages(this, delivery); },
  onAbortRequest(this: AppState, handler) { return onAbortRequest(this, handler); },
  dismissPassiveBtwBubble(this: AppState) { return dismissPassiveBtwBubble(this); },
  clearComposerViewport(this: AppState) { return clearComposerViewport(this); },
};
