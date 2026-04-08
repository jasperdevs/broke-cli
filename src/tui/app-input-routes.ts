import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import { renderBudgetDashboard } from "../core/budget-insights.js";
import { filterFiles } from "./file-picker.js";
import type { Keypress } from "./keypress.js";
import { ensureInlineImageChips, getImageChipLabel, insertInlineImageChip, snapCursorOutsideInlineChip, stripInlineChipLabels } from "./inline-chip-utils.js";
import { DIM, RESET } from "../utils/ansi.js";
import { T } from "./app-shared.js";
import { getSelectedTreeItem, getVisibleTreeRows, moveTreeSelection, pageTreeSelection, toggleTreeFilter, toggleTreeFold, toggleTreeLabel, toggleTreeTimestampMode } from "./tree-view.js";

type AppState = any;

function normalizePastedPath(text: string): string {
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

function resolveImagePath(rawText: string): string | null {
  const normalizedPath = normalizePastedPath(rawText);
  const imageExt = getImageExtension(normalizedPath);
  if (!imageExt) return null;
  if (existsSync(normalizedPath)) return normalizedPath;

  const parentDir = dirname(normalizedPath);
  if (!parentDir || !existsSync(parentDir)) return null;

  // Yoink on Windows can paste a transient filename before the actual saved file name settles.
  const parentName = basename(parentDir).toLowerCase();
  if (parentName !== "yoink") return null;

  const now = Date.now();
  const fallback = readdirSync(parentDir)
    .filter((entry) => extname(entry).toLowerCase() === imageExt)
    .map((entry) => {
      const fullPath = join(parentDir, entry);
      try {
        return { path: fullPath, mtimeMs: statSync(fullPath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; mtimeMs: number } => !!entry)
    .filter((entry) => now - entry.mtimeMs < 10_000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

  return fallback?.path ?? null;
}

function isPlainBackspace(key: Keypress): boolean {
  return key.name === "backspace" && !key.ctrl && !key.meta && !key.shift;
}

function tryLoadImageFromPath(app: AppState, rawText: string, insertChip = false): boolean {
  const resolvedPath = resolveImagePath(rawText);
  if (!resolvedPath) return false;
  try {
    const data = readFileSync(resolvedPath);
    const ext = resolvedPath.split(".").pop()?.toLowerCase() || "png";
    const mimeType = `image/${ext === "jpg" ? "jpeg" : ext}`;
    const base64 = data.toString("base64");
    app.pendingImages.push({ mimeType, data: base64 });
    if (insertChip) insertInlineImageChip(app);
    return true;
  } catch {
    return false;
  }
}

function stripMirroredImagePathFromDraft(app: AppState, rawText: string): void {
  const normalizedPath = normalizePastedPath(rawText);
  const currentText = app.input.getText();
  const trimmedCurrent = currentText.trim();
  if (trimmedCurrent === normalizedPath) {
    app.input.clear();
    ensureInlineImageChips(app);
    return;
  }
  if (currentText.endsWith(normalizedPath)) {
    app.input.setText(currentText.slice(0, currentText.length - normalizedPath.length).trimEnd(), true);
    ensureInlineImageChips(app);
  }
}

function looksLikeImageDraft(text: string): boolean {
  return !!getImageExtension(normalizePastedPath(text.trim()));
}

function draftStillContainsRawImagePath(app: AppState, rawText: string): boolean {
  const normalizedPath = normalizePastedPath(rawText);
  const currentText = app.input.getText();
  return currentText.includes(normalizedPath) || currentText.trim() === normalizedPath;
}

function scheduleDeferredPastedImageLoad(app: AppState, rawText: string): void {
  if (!looksLikeImageDraft(rawText)) return;
  for (const delayMs of [40, 140, 300, 600, 1000, 1500, 2200]) {
    setTimeout(() => {
      if (!draftStillContainsRawImagePath(app, rawText)) return;
      if (!tryLoadImageFromPath(app, rawText)) return;
      stripMirroredImagePathFromDraft(app, rawText);
      ensureInlineImageChips(app);
      queueMicrotask(() => stripMirroredImagePathFromDraft(app, rawText));
      app.draw?.();
    }, delayMs);
  }
}

export function tryConsumeImageDraft(app: AppState): boolean {
  snapCursorOutsideInlineChip(app);
  const text = app.input.getText().trim();
  if (!text) return false;
  if (!tryLoadImageFromPath(app, text)) return false;
  app.input.clear();
  insertInlineImageChip(app);
  return true;
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

export function handleBudgetViewKey(app: AppState, key: Keypress): void {
  const page = Math.max(1, app.screen.height - 7);
  const report = app.budgetView.reports[app.budgetView.scope];
  const lineCount = renderBudgetDashboard({
    report,
    width: Math.max(20, app.screen.width - 4),
    scopeLabel: app.budgetView.scope === "all" ? "all sessions" : "current session",
    contextTokens: app.contextTokenCount,
    contextLimit: app.contextLimitTokens,
    showContext: app.budgetView.scope === "session",
    section: app.budgetView.section,
  }).length;
  const maxScroll = Math.max(0, lineCount - Math.max(1, app.screen.height - 6));
  if (key.name === "escape" || isPlainBackspace(key) || key.name === "q" || (key.ctrl && key.name === "c")) {
    app.closeBudgetView();
    return;
  }
  if (key.name === "tab") {
    const order = ["usage", "efficiency", "routing", "context"] as const;
    const current = Math.max(0, order.indexOf(app.budgetView.section));
    const direction = key.shift ? -1 : 1;
    app.budgetView.section = order[(current + direction + order.length) % order.length]!;
    app.budgetView.scrollOffset = 0;
    app.drawNow();
    return;
  }
  if (key.name === "s") {
    app.budgetView.scope = app.budgetView.scope === "all" ? "session" : "all";
    if (app.budgetView.scope === "all" && app.budgetView.section === "context") app.budgetView.section = "usage";
    app.budgetView.scrollOffset = 0;
    app.drawNow();
    return;
  }
  if (key.name === "up") {
    app.budgetView.scrollOffset = Math.max(0, app.budgetView.scrollOffset - 1);
    app.draw();
    return;
  }
  if (key.name === "down") {
    app.budgetView.scrollOffset = Math.min(maxScroll, app.budgetView.scrollOffset + 1);
    app.draw();
    return;
  }
  if (key.name === "pageup") {
    app.budgetView.scrollOffset = Math.max(0, app.budgetView.scrollOffset - page);
    app.draw();
    return;
  }
  if (key.name === "pagedown") {
    app.budgetView.scrollOffset = Math.min(maxScroll, app.budgetView.scrollOffset + page);
    app.draw();
  }
}

export function handleTreeViewKey(app: AppState, key: Keypress): void {
  const queryEmpty = app.getMenuFilterQuery().length === 0;
  if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
    app.closeTreeView();
    return;
  }
  if (isPlainBackspace(key) && queryEmpty) {
    app.closeTreeView();
    return;
  }
  if (key.name === "up") moveTreeSelection(app, -1);
  else if (key.name === "down") moveTreeSelection(app, 1);
  else if (key.name === "home") {
    const rows = getVisibleTreeRows(app);
    app.treeView.selectedId = rows[0]?.item.id ?? null;
  } else if (key.name === "end") {
    const rows = getVisibleTreeRows(app);
    app.treeView.selectedId = rows[rows.length - 1]?.item.id ?? app.treeView.selectedId;
  } else if (key.name === "pageup") {
    pageTreeSelection(app, -1);
  } else if (key.name === "pagedown") {
    pageTreeSelection(app, 1);
  } else if (key.name === "left" && !key.ctrl && !key.meta) {
    pageTreeSelection(app, -1);
  } else if (key.name === "right" && !key.ctrl && !key.meta) {
    pageTreeSelection(app, 1);
  } else if ((key.ctrl || key.meta) && key.name === "left") {
    toggleTreeFold(app, -1);
  } else if ((key.ctrl || key.meta) && key.name === "right") {
    toggleTreeFold(app, 1);
  } else if (key.shift && key.char?.toLowerCase() === "l") {
    toggleTreeLabel(app);
  } else if (key.shift && key.char?.toLowerCase() === "t") {
    toggleTreeTimestampMode(app);
  } else if (key.ctrl && key.name === "u") {
    toggleTreeFilter(app, "user-only");
  } else if (key.ctrl && key.name === "o") {
    toggleTreeFilter(app, "all");
  } else if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
    app.selectTreeEntry?.();
    return;
  } else if (app.handleMenuPromptKey(key)) {
    const rows = getVisibleTreeRows(app);
    app.treeView.selectedId = rows.find((row) => row.item.active)?.item.id ?? rows[0]?.item.id ?? null;
    app.treeView.scrollOffset = 0;
  } else if (isPlainBackspace(key) && !queryEmpty) {
    app.handleMenuPromptKey(key);
  }
  app.draw();
}

export function handlePickerKey(app: AppState, key: Keypress): void {
  if (app.settingsPicker) {
    const filtered = app.getFilteredSettings();
    if (key.name === "up") app.settingsPicker.cursor = app.clampMenuCursor(app.settingsPicker.cursor - 1, filtered.length);
    else if (key.name === "down") app.settingsPicker.cursor = app.clampMenuCursor(app.settingsPicker.cursor + 1, filtered.length);
    else if (key.name === "home") app.settingsPicker.cursor = 0;
    else if (key.name === "end") app.settingsPicker.cursor = app.clampMenuCursor(filtered.length - 1, filtered.length);
    else if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) app.toggleSettingEntry(app.settingsPicker.cursor);
    else if (isPlainBackspace(key) && app.getMenuFilterQuery().length === 0) {
      app.settingsPicker = null;
      app.input.clear();
      app.drawNow();
      return;
    }
    else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      app.settingsPicker = null;
      app.input.clear();
      app.drawNow();
      return;
    } else if (app.handleMenuPromptKey(key)) {
      app.settingsPicker.cursor = 0;
    }
    app.draw();
    return;
  }
  if (app.itemPicker) {
    if (app.itemPicker.onKey?.(key)) {
      app.draw();
      return;
    }
    const filtered = app.getFilteredItems();
    if (key.name === "up") app.itemPicker.cursor = app.clampMenuCursor(app.itemPicker.cursor - 1, filtered.length);
    else if (key.name === "down") app.itemPicker.cursor = app.clampMenuCursor(app.itemPicker.cursor + 1, filtered.length);
    else if (key.name === "home") app.itemPicker.cursor = 0;
    else if (key.name === "end") app.itemPicker.cursor = app.clampMenuCursor(filtered.length - 1, filtered.length);
    else if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
      app.selectItemEntry(app.itemPicker.cursor);
      return;
    } else if (isPlainBackspace(key) && app.getMenuFilterQuery().length === 0) {
      app.closeItemPicker(true);
      return;
    } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      app.closeItemPicker(true);
      return;
    } else if (app.handleMenuPromptKey(key)) {
      app.itemPicker.cursor = 0;
    }
    app.previewCurrentItem();
    app.draw();
    return;
  }
  if (app.modelPicker) {
    if (app.modelLanePicker) {
      const total = app.modelLanePicker.options.length;
      if (key.name === "up") app.modelLanePicker.cursor = app.clampMenuCursor(app.modelLanePicker.cursor - 1, total);
      else if (key.name === "down") app.modelLanePicker.cursor = app.clampMenuCursor(app.modelLanePicker.cursor + 1, total);
      else if (key.name === "home") app.modelLanePicker.cursor = 0;
      else if (key.name === "end") app.modelLanePicker.cursor = app.clampMenuCursor(total - 1, total);
      else if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
        app.selectModelLaneEntry(app.modelLanePicker.cursor);
        return;
      } else if (key.name === "escape" || (isPlainBackspace(key) && app.getMenuFilterQuery().length === 0)) {
        app.modelLanePicker = null;
        app.drawNow();
        return;
      }
      app.draw();
      return;
    }
    const filtered = app.getFilteredModels();
    const page = Math.max(1, app.screen.height - 8);
    if (key.name === "up") app.modelPicker.cursor = app.clampMenuCursor(app.modelPicker.cursor - 1, filtered.length);
    else if (key.name === "down") app.modelPicker.cursor = app.clampMenuCursor(app.modelPicker.cursor + 1, filtered.length);
    else if (key.name === "pageup") app.modelPicker.cursor = app.clampMenuCursor(app.modelPicker.cursor - page, filtered.length);
    else if (key.name === "pagedown") app.modelPicker.cursor = app.clampMenuCursor(app.modelPicker.cursor + page, filtered.length);
    else if (key.name === "home") app.modelPicker.cursor = 0;
    else if (key.name === "end") app.modelPicker.cursor = app.clampMenuCursor(filtered.length - 1, filtered.length);
    else if (key.name === "space") app.toggleModelPin(app.modelPicker.cursor);
    else if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
      app.openModelLanePicker(app.modelPicker.cursor);
      return;
    } else if (isPlainBackspace(key) && app.getMenuFilterQuery().length === 0) {
      app.modelPicker = null;
      app.input.clear();
      app.drawNow();
      return;
    } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      app.modelPicker = null;
      app.input.clear();
      app.drawNow();
      return;
    } else if (app.handleMenuPromptKey(key)) {
      app.modelPicker.cursor = 0;
    }
    app.draw();
  }
}

export function handleFilePickerKey(app: AppState, key: Keypress): void {
  if (key.name === "up") app.filePicker.cursor = app.clampMenuCursor(app.filePicker.cursor - 1, app.filePicker.filtered.length);
  else if (key.name === "down") app.filePicker.cursor = app.clampMenuCursor(app.filePicker.cursor + 1, app.filePicker.filtered.length);
  else if (key.name === "home") app.filePicker.cursor = 0;
  else if (key.name === "end") app.filePicker.cursor = app.clampMenuCursor(app.filePicker.filtered.length - 1, app.filePicker.filtered.length);
  else if (((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) || key.name === "tab") {
    app.selectFileEntry(app.filePicker.cursor);
    return;
  } else if (key.name === "escape") {
    app.filePicker = null;
    app.drawNow();
    return;
  } else if (key.name === "backspace") {
    if (app.filePicker.query.length > 0) {
      app.filePicker.query = app.filePicker.query.slice(0, -1);
      app.filePicker.filtered = filterFiles(app.filePicker.files, app.filePicker.query);
      app.filePicker.cursor = 0;
      app.input.handleKey(key);
      app.draw();
      return;
    }
    app.filePicker = null;
    app.input.handleKey(key);
    app.drawNow();
    return;
  } else if (key.char && !key.ctrl && !key.meta) {
    app.filePicker.query += key.char;
    app.filePicker.filtered = filterFiles(app.filePicker.files, app.filePicker.query);
    app.filePicker.cursor = 0;
    app.input.handleKey(key);
    app.draw();
    return;
  }
  app.draw();
}

export function submitInput(app: AppState): void {
  submitQueuedInput(app, "steering");
}

export function queueCurrentInput(app: AppState, delivery: "steering" | "followup"): void {
  submitQueuedInput(app, delivery);
}

export function restoreQueuedMessage(app: AppState): void {
  const queued = app.takeLastPendingMessage();
  if (!queued) {
    app.draw();
    return;
  }
  if (queued.images && queued.images.length > 0) {
    app.pendingImages = [...queued.images, ...app.pendingImages];
  }
  app.input.setText(queued.text);
  app.drawNow();
}

export function handlePaste(app: AppState, text: string): void {
  snapCursorOutsideInlineChip(app);
  if (text.startsWith("data:image/")) {
    const match = text.match(/^data:image\/(\w+);base64,(.+)$/);
    if (match) {
      const mimeType = `image/${match[1]}`;
      const data = match[2];
      app.pendingImages.push({ mimeType, data });
      insertInlineImageChip(app);
      app.setStatus?.(`${T()}✓ Image attached (${mimeType})${RESET}`);
      app.draw();
      return;
    }
  }

  if (tryLoadImageFromPath(app, text)) {
    stripMirroredImagePathFromDraft(app, text);
    ensureInlineImageChips(app);
    queueMicrotask(() => stripMirroredImagePathFromDraft(app, text));
    setTimeout(() => stripMirroredImagePathFromDraft(app, text), 0);
    app.draw();
    return;
  }
  app.input.paste(text);
  scheduleDeferredPastedImageLoad(app, text);
  if (tryConsumeImageDraft(app)) {
    app.draw();
    return;
  }
  scheduleDeferredImageDraftConsume(app);
  app.draw();
}

function submitQueuedInput(app: AppState, delivery: "steering" | "followup"): void {
  const rawText = app.input.submit();
  const text = stripInlineChipLabels(app, rawText);
  if (!app.pendingImages.length && tryLoadImageFromPath(app, text.trim())) {
    app.draw();
    return;
  }
  const images = app.takePendingImages();
  if ((!text && images.length === 0) || !app.onSubmit) return;
  const trimmed = text.trimStart();
  const shouldBypassQueue = trimmed.startsWith("/btw ");
  if (!app.isStreaming) {
    if (images.length > 0) (app.onSubmit as (text: string, images?: Array<{ mimeType: string; data: string }>) => void)(text, images);
    else app.onSubmit(text);
    return;
  }
  if (shouldBypassQueue) {
    if (images.length > 0) (app.onSubmit as (text: string, images?: Array<{ mimeType: string; data: string }>) => void)(text, images);
    else app.onSubmit(text);
    return;
  }
  app.addPendingMessage(text, images, delivery);
  app.draw();
}
