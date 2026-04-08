import type { PendingDelivery, PendingImage, PendingMessage, TodoItem } from "./app-types.js";

type AppState = any;

export function clearMessages(app: AppState): void {
  app.messages = [];
  app.scrollOffset = 0;
  app.refreshHomeScreenData();
  app.invalidateMsgCache();
  app.screen.forceRedraw([]);
  app.draw();
}

export function setDraft(app: AppState, text: string): void {
  app.input.setText(text);
  app.drawNow();
}

export function addMessage(app: AppState, role: "user" | "assistant" | "system", content: string, images?: PendingImage[]): void {
  if (role === "user") {
    app.thinkingBuffer = "";
    app.thinkingStartTime = 0;
    app.thinkingDuration = 0;
  }
  app.messages.push({ role, content, images });
  app.invalidateMsgCache();
  app.scrollToBottom();
  app.draw();
}

export function appendToLastMessage(app: AppState, text: string): void {
  if (app.thinkingStartTime > 0 && app.thinkingBuffer) {
    app.thinkingDuration = Math.floor((Date.now() - app.thinkingStartTime) / 1000);
    app.thinkingStartTime = 0;
  }
  const last = app.messages[app.messages.length - 1];
  if (last && last.role === "assistant") last.content += text;
  else app.messages.push({ role: "assistant", content: text });
  app.invalidateMsgCache();
  app.scrollToBottom();
  app.draw();
}

export function replaceLastAssistantMessage(app: AppState, text: string): void {
  const last = app.messages[app.messages.length - 1];
  if (last && last.role === "assistant") last.content = text;
  else app.messages.push({ role: "assistant", content: text });
  app.invalidateMsgCache();
  app.scrollToBottom();
  app.draw();
}

export function appendThinking(app: AppState, delta: string): void {
  if (!app.thinkingBuffer && delta) app.thinkingStartTime = Date.now();
  app.thinkingBuffer += delta;
  app.scrollToBottom();
  app.draw();
}

export function updateTodo(app: AppState, items: TodoItem[]): void {
  app.todoItems = items;
  app.invalidateMsgCache();
  app.draw();
}

export function addToolCall(app: AppState, name: string, preview: string, args?: unknown): void {
  app.toolCallGroups.push({ name, preview, args, expanded: app.allToolsExpanded });
  const maxW = app.screen.mainWidth - 4;
  const tc = app.toolCallGroups[app.toolCallGroups.length - 1];
  const block = app.renderToolCallBlock(tc, maxW);
  if (block.length > 0) {
    app.messages.push({ role: "system", content: block.join("\n") });
    tc.messageIndex = app.messages.length - 1;
  }
  app.invalidateMsgCache();
  app.scrollToBottom();
  app.drawNow();
}

export function updateToolCallArgs(app: AppState, name: string, preview: string, args: unknown): void {
  for (let i = app.toolCallGroups.length - 1; i >= 0; i--) {
    const tc = app.toolCallGroups[i];
    if (tc.name === name && !tc.result) {
      tc.preview = preview;
      tc.args = args;
      const maxW = app.screen.mainWidth - 4;
      const block = app.renderToolCallBlock(tc, maxW);
      if (typeof tc.messageIndex === "number" && app.messages[tc.messageIndex]?.role === "system") {
        app.messages[tc.messageIndex].content = block.join("\n");
      }
      app.invalidateMsgCache();
      app.drawNow();
      return;
    }
  }
  app.addToolCall(name, preview, args);
}

export function addToolResult(app: AppState, name: string, result: string, error?: boolean, resultDetail?: string): void {
  for (let i = app.toolCallGroups.length - 1; i >= 0; i--) {
    if (app.toolCallGroups[i].name === name && !app.toolCallGroups[i].result) {
      app.toolCallGroups[i].result = result;
      app.toolCallGroups[i].error = error;
      app.toolCallGroups[i].resultDetail = resultDetail;
      const maxW = app.screen.mainWidth - 4;
      const block = app.renderToolCallBlock(app.toolCallGroups[i], maxW);
      const messageIndex = app.toolCallGroups[i].messageIndex;
      if (typeof messageIndex === "number" && app.messages[messageIndex]?.role === "system") {
        app.messages[messageIndex].content = block.join("\n");
      }
      break;
    }
  }
  app.invalidateMsgCache();
  app.scrollToBottom();
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
    app.scrollToBottom();
    app.ensureUiSpinner();
  } else if (!app.isStreaming) {
    app.releaseUiSpinnerIfIdle();
  }
  app.refreshWindowTitle?.();
  app.draw();
}

export function appendToolOutput(app: AppState, chunk: string): void {
  for (let i = app.toolCallGroups.length - 1; i >= 0; i--) {
    const tc = app.toolCallGroups[i];
    if (tc.name === "bash" && !tc.result) {
      tc.streamOutput = (tc.streamOutput ?? "") + chunk;
      const maxW = app.screen.mainWidth - 4;
      const block = app.renderToolCallBlock(tc, maxW);
      if (typeof tc.messageIndex === "number" && app.messages[tc.messageIndex]?.role === "system") {
        app.messages[tc.messageIndex].content = block.join("\n");
      }
      app.invalidateMsgCache();
      app.scrollToBottom();
      app.drawNow();
      return;
    }
  }
}

export function collapseToolCalls(app: AppState): void { app.toolCallGroups = []; }

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

export function onInput(app: AppState, handler: (text: string, images?: PendingImage[]) => void): void {
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

export function addPendingMessage(app: AppState, text: string, images?: PendingImage[], delivery: PendingDelivery = "followup"): void {
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
  setDraft(text: string): void;
  addMessage(role: "user" | "assistant" | "system", content: string, images?: PendingImage[]): void;
  appendToLastMessage(text: string): void;
  replaceLastAssistantMessage(text: string): void;
  appendThinking(delta: string): void;
  updateTodo(items: TodoItem[]): void;
  addToolCall(name: string, preview: string, args?: unknown): void;
  updateToolCallArgs(name: string, preview: string, args: unknown): void;
  addToolResult(name: string, result: string, error?: boolean, resultDetail?: string): void;
  setStreamTokens(tokens: number): void;
  setCompacting(compacting: boolean, tokenCount?: number): void;
  appendToolOutput(chunk: string): void;
  collapseToolCalls(): void;
  getLastAssistantContent(): string;
  rollbackLastAssistantMessage(): void;
  getFileContexts(): Map<string, string>;
  setStatus(message: string): void;
  clearStatus(): void;
  onInput(handler: (text: string, images?: PendingImage[]) => void): void;
  onPendingMessagesReadyHandler(handler: (delivery: PendingDelivery) => void): void;
  takePendingImages(): PendingImage[];
  addPendingMessage(text: string, images?: PendingImage[], delivery?: PendingDelivery): void;
  takePendingMessages(delivery?: PendingDelivery): PendingMessage[];
  takeLastPendingMessage(): PendingMessage | undefined;
  clearPendingMessages(delivery?: PendingDelivery): void;
  hasPendingMessages(delivery?: PendingDelivery): boolean;
  getPendingMessagesCount(delivery?: PendingDelivery): number;
  flushPendingMessages(delivery: PendingDelivery): void;
  onAbortRequest(handler: () => void): void;
}

export const appStateMessageMethods: AppStateMessageMethods = {
  clearMessages(this: AppState) { return clearMessages(this); },
  setDraft(this: AppState, text) { return setDraft(this, text); },
  addMessage(this: AppState, role, content, images) { return addMessage(this, role, content, images); },
  appendToLastMessage(this: AppState, text) { return appendToLastMessage(this, text); },
  replaceLastAssistantMessage(this: AppState, text) { return replaceLastAssistantMessage(this, text); },
  appendThinking(this: AppState, delta) { return appendThinking(this, delta); },
  updateTodo(this: AppState, items) { return updateTodo(this, items); },
  addToolCall(this: AppState, name, preview, args) { return addToolCall(this, name, preview, args); },
  updateToolCallArgs(this: AppState, name, preview, args) { return updateToolCallArgs(this, name, preview, args); },
  addToolResult(this: AppState, name, result, error, resultDetail) { return addToolResult(this, name, result, error, resultDetail); },
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
};
