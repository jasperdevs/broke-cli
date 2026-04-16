import type { PendingDelivery, PendingImage, PendingMessage, ResolvedImage } from "./app-types.js";

interface PendingMessageState {
  pendingImages: PendingImage[];
  pendingMessages: PendingMessage[];
  onPendingMessagesReady: ((delivery: PendingDelivery) => void) | null;
  draw(): void;
}

export function onPendingMessagesReadyHandler(app: PendingMessageState, handler: (delivery: PendingDelivery) => void): void {
  app.onPendingMessagesReady = handler;
}

export function takePendingImages(app: PendingMessageState): PendingImage[] {
  const images = app.pendingImages;
  app.pendingImages = [];
  return images;
}

export function addPendingMessage(app: PendingMessageState, text: string, images?: ResolvedImage[], delivery: PendingDelivery = "followup"): void {
  app.pendingMessages.push({ text, images, delivery });
  app.draw();
}

export function takePendingMessages(app: PendingMessageState, delivery?: PendingDelivery): PendingMessage[] {
  if (!delivery) {
    const messages = app.pendingMessages;
    app.pendingMessages = [];
    return messages;
  }
  const messages = app.pendingMessages.filter((entry) => entry.delivery === delivery);
  app.pendingMessages = app.pendingMessages.filter((entry) => entry.delivery !== delivery);
  return messages;
}

export function takeNextPendingMessage(app: PendingMessageState, delivery: PendingDelivery): PendingMessage | undefined {
  const index = app.pendingMessages.findIndex((entry) => entry.delivery === delivery);
  if (index < 0) return undefined;
  const [message] = app.pendingMessages.splice(index, 1);
  return message;
}

export function takeLastPendingMessage(app: PendingMessageState): PendingMessage | undefined {
  if (app.pendingMessages.length === 0) return undefined;
  return app.pendingMessages.pop();
}

export function clearPendingMessages(app: PendingMessageState, delivery?: PendingDelivery): void {
  if (!delivery) app.pendingMessages = [];
  else app.pendingMessages = app.pendingMessages.filter((entry) => entry.delivery !== delivery);
  app.draw();
}

export function hasPendingMessages(app: PendingMessageState, delivery?: PendingDelivery): boolean {
  return delivery ? app.pendingMessages.some((entry) => entry.delivery === delivery) : app.pendingMessages.length > 0;
}

export function getPendingMessagesCount(app: PendingMessageState, delivery?: PendingDelivery): number {
  return delivery ? app.pendingMessages.filter((entry) => entry.delivery === delivery).length : app.pendingMessages.length;
}

export function flushPendingMessages(app: PendingMessageState, delivery: PendingDelivery): void {
  app.onPendingMessagesReady?.(delivery);
}
