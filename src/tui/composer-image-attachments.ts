import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import { RESET } from "../utils/ansi.js";
import { T } from "./app-shared.js";
import { hydrateInlineComposerElements, insertInlineImageChip, syncInlineImageChipLabels } from "./inline-chip-utils.js";

type AppState = any;

export function normalizePastedPath(text: string): string {
  let normalized = text.trim();
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (/^file:\/\//i.test(normalized)) {
    try {
      normalized = fileURLToPath(normalized);
    } catch {
      // Fall back to the original text if URL parsing fails.
    }
  }
  return normalized;
}

function getImageExtension(normalizedPath: string): string | null {
  const ext = extname(normalizedPath).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext) ? ext : null;
}

function sharedStemScore(expectedPath: string, candidatePath: string): number {
  const expected = basename(expectedPath, extname(expectedPath)).toLowerCase();
  const candidate = basename(candidatePath, extname(candidatePath)).toLowerCase();
  if (!expected || !candidate) return 0;
  if (expected === candidate) return 100;
  const expectedTokens = expected.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  const candidateTokens = new Set(candidate.split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
  const overlap = expectedTokens.filter((token) => candidateTokens.has(token)).length;
  return overlap;
}

function resolveRecentSiblingImage(normalizedPath: string, imageExt: string): string | null {
  const parentDir = dirname(normalizedPath);
  if (!parentDir || !existsSync(parentDir)) return null;

  const now = Date.now();
  const candidates = readdirSync(parentDir)
    .filter((entry) => extname(entry).toLowerCase() === imageExt)
    .map((entry) => {
      const path = join(parentDir, entry);
      try {
        return { path, mtimeMs: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; mtimeMs: number } => !!entry)
    .filter((entry) => now - entry.mtimeMs < 10_000);

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.path;

  const ranked = candidates
    .map((entry) => ({ ...entry, score: sharedStemScore(normalizedPath, entry.path) }))
    .sort((a, b) => (b.score - a.score) || (b.mtimeMs - a.mtimeMs));

  const best = ranked[0]!;
  if (best.score > 0) return best.path;
  return null;
}

function resolveImagePath(rawText: string): string | null {
  const normalizedPath = normalizePastedPath(rawText);
  const imageExt = getImageExtension(normalizedPath);
  if (!imageExt) return null;
  if (existsSync(normalizedPath)) return normalizedPath;
  return resolveRecentSiblingImage(normalizedPath, imageExt);
}

export function looksLikeImageDraft(text: string): boolean {
  return !!getImageExtension(normalizePastedPath(text.trim()));
}

function createAttachmentId(): string {
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function findMirroredPathRange(app: AppState, rawText: string): { start: number; end: number } | null {
  const normalizedPath = normalizePastedPath(rawText);
  const currentText = app.input.getText();
  const start = currentText.lastIndexOf(normalizedPath);
  return start < 0 ? null : { start, end: start + normalizedPath.length };
}

function readImagePayload(resolvedPath: string, attachmentId: string): { attachmentId: string; mimeType: string; data: string; resolvedPath: string } | null {
  try {
    const data = readFileSync(resolvedPath);
    const ext = resolvedPath.split(".").pop()?.toLowerCase() || "png";
    const mimeType = `image/${ext === "jpg" ? "jpeg" : ext}`;
    const base64 = data.toString("base64");
    return { attachmentId, mimeType, data: base64, resolvedPath };
  } catch {
    return null;
  }
}

function addResolvedImageAttachment(app: AppState, resolvedPath: string, attachmentId = createAttachmentId(), replaceStart?: number, replaceEnd?: number): boolean {
  const payload = readImagePayload(resolvedPath, attachmentId);
  if (!payload) return false;
  const existingIndex = (app.pendingImages ?? []).findIndex((image: { attachmentId?: string }) => image.attachmentId === attachmentId);
  if (existingIndex >= 0) app.pendingImages[existingIndex] = payload;
  else app.pendingImages.push(payload);
  insertInlineImageChip(app, attachmentId, replaceStart, replaceEnd);
  syncInlineImageChipLabels(app);
  return true;
}

function addPendingImageAttachment(app: AppState, pendingPath: string, replaceStart?: number, replaceEnd?: number): string {
  const attachmentId = createAttachmentId();
  app.pendingImages.push({ attachmentId, pendingPath });
  insertInlineImageChip(app, attachmentId, replaceStart, replaceEnd);
  syncInlineImageChipLabels(app);
  return attachmentId;
}

function settlePendingImageAttachment(app: AppState, attachmentId: string, rawText: string): boolean {
  const resolvedPath = resolveImagePath(rawText);
  if (!resolvedPath) return false;
  const payload = readImagePayload(resolvedPath, attachmentId);
  if (!payload) return false;
  const index = (app.pendingImages ?? []).findIndex((image: { attachmentId?: string }) => image.attachmentId === attachmentId);
  if (index < 0) return false;
  app.pendingImages[index] = payload;
  syncInlineImageChipLabels(app);
  return true;
}

function reconcileMirroredPathDraft(app: AppState, rawText: string, attachmentId: string): boolean {
  hydrateInlineComposerElements(app);
  const range = findMirroredPathRange(app, rawText);
  if (!range) return false;
  const existingElement = (app.input.getElements?.() ?? [])
    .find((element: { kind: string; meta?: Record<string, unknown> }) =>
      element.kind === "image" && String((element.meta as { attachmentId?: string } | undefined)?.attachmentId ?? "") === attachmentId);
  if (existingElement) return false;
  app.input.setCursor(range.start);
  insertInlineImageChip(app, attachmentId, range.start, range.end);
  syncInlineImageChipLabels(app);
  return true;
}

function scheduleMirroredPathReconciliation(app: AppState, rawText: string, attachmentId: string): void {
  for (const delayMs of [0, 20, 80]) {
    setTimeout(() => {
      if (!reconcileMirroredPathDraft(app, rawText, attachmentId)) return;
      app.draw?.();
    }, delayMs);
  }
}

function scheduleDeferredPendingImageResolution(app: AppState, rawText: string, attachmentId: string): void {
  for (const delayMs of [40, 140, 300, 600, 1000, 1500, 2200]) {
    setTimeout(() => {
      if (!settlePendingImageAttachment(app, attachmentId, rawText)) return;
      app.draw?.();
    }, delayMs);
  }
}

function tryAttachImagePath(app: AppState, rawText: string, replaceStart?: number, replaceEnd?: number): boolean {
  const resolvedPath = resolveImagePath(rawText);
  if (resolvedPath) return addResolvedImageAttachment(app, resolvedPath, createAttachmentId(), replaceStart, replaceEnd);
  if (!looksLikeImageDraft(rawText)) return false;
  addPendingImageAttachment(app, normalizePastedPath(rawText), replaceStart, replaceEnd);
  return true;
}

export function handleImagePaste(app: AppState, text: string): boolean {
  hydrateInlineComposerElements(app);
  if (text.startsWith("data:image/")) {
    const match = text.match(/^data:image\/(\w+);base64,(.+)$/);
    if (match) {
      const mimeType = `image/${match[1]}`;
      const data = match[2];
      const attachmentId = createAttachmentId();
      app.pendingImages.push({ attachmentId, mimeType, data });
      insertInlineImageChip(app, attachmentId);
      syncInlineImageChipLabels(app);
      app.setStatus?.(`${T()}Image attached (${mimeType})${RESET}`);
      return true;
    }
  }

  if (!looksLikeImageDraft(text)) return false;
  const mirroredRange = findMirroredPathRange(app, text);
  const normalized = normalizePastedPath(text);
  const resolvedPath = resolveImagePath(text);
  if (resolvedPath) {
    const attachmentId = createAttachmentId();
    addResolvedImageAttachment(app, resolvedPath, attachmentId, mirroredRange?.start, mirroredRange?.end);
    scheduleMirroredPathReconciliation(app, normalized, attachmentId);
    return true;
  }
  const attachmentId = addPendingImageAttachment(app, normalized, mirroredRange?.start, mirroredRange?.end);
  scheduleDeferredPendingImageResolution(app, normalized, attachmentId);
  scheduleMirroredPathReconciliation(app, normalized, attachmentId);
  return true;
}

export function tryConsumeImageDraft(app: AppState): boolean {
  hydrateInlineComposerElements(app);
  const text = app.input.getText().trim();
  if (!text || !looksLikeImageDraft(text)) return false;
  app.input.setText("");
  return tryAttachImagePath(app, text);
}

export function scheduleDeferredImageDraftConsume(app: AppState): void {
  const draft = app.input.getText().trim();
  if (!draft || !looksLikeImageDraft(draft)) return;
  for (const delayMs of [40, 140]) {
    setTimeout(() => {
      if (app.input.getText().trim() !== draft) return;
      if (!tryConsumeImageDraft(app)) return;
      app.draw?.();
    }, delayMs);
  }
}

export function resolvePendingImagesBeforeSubmit(app: AppState): boolean {
  const unresolved = (app.pendingImages ?? []).filter((image: { pendingPath?: string; attachmentId?: string }) => image.pendingPath);
  if (unresolved.length === 0) return true;
  for (const image of unresolved) {
    if (!image.attachmentId || !image.pendingPath) continue;
    settlePendingImageAttachment(app, image.attachmentId, image.pendingPath);
  }
  const stillPending = (app.pendingImages ?? []).some((image: { pendingPath?: string }) => image.pendingPath);
  if (!stillPending) return true;
  app.setStatus?.(`${T()}Waiting for dropped image file to finish saving${RESET}`);
  return false;
}
