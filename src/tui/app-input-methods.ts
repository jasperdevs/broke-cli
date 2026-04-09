import { collectProjectFiles } from "./file-picker.js";
import type { Keypress } from "./keypress.js";
import { matchesBinding, loadKeybindings } from "../core/keybindings.js";
import { getSettings } from "../core/config.js";
import { ensureInlineChipElements, getImageChipLabel, syncInlineImageChipLabels } from "./inline-chip-utils.js";
import { canonicalizeSlashInput } from "./command-surface.js";
import { handleQuestionViewKey } from "./question-view.js";
import {
  handleBudgetViewKey,
  handleFilePickerKey,
  handlePaste,
  handlePickerKey,
  handleTreeViewKey,
  scheduleDeferredImageDraftConsume,
  queueCurrentInput,
  restoreQueuedMessage,
  submitInput,
  shouldKeepFilePickerOpen,
  tryConsumeImageDraft,
} from "./app-input-routes.js";

type AppState = any;

function syncComposerAttachmentsFromInput(app: AppState): void {
  for (const file of Array.from(app.fileContexts.keys())) {
    if (!app.input.getText().includes(file)) app.fileContexts.delete(file);
  }

  const elements = app.input.getElements?.() ?? [];
  const activeImages = new Set(
    elements
      .filter((element: { kind: string; meta?: Record<string, unknown> }) => element.kind === "image")
      .map((element: { meta?: Record<string, unknown> }) => String(element.meta?.attachmentId ?? "")),
  );
  app.pendingImages = app.pendingImages.filter((image: { attachmentId?: string }) =>
    !image.attachmentId || activeImages.has(image.attachmentId),
  );
  syncInlineImageChipLabels(app);
}

function tryDeleteVisiblePlaceholderFallback(app: AppState, key: Keypress, beforeText: string, beforeCursor: number): boolean {
  if (!((key.name === "backspace" || key.name === "delete") && !key.ctrl && !key.meta && !key.shift)) return false;
  const placeholders: Array<{ kind: "image"; id: string; label: string; start: number; end: number }> = [];
  for (let index = 0; index < (app.pendingImages?.length ?? 0); index++) {
    const image = app.pendingImages[index];
    const label = getImageChipLabel(index);
    let searchFrom = 0;
    while (searchFrom < beforeText.length) {
      const start = beforeText.indexOf(label, searchFrom);
      if (start < 0) break;
      placeholders.push({ kind: "image", id: image.attachmentId ?? String(index), label, start, end: start + label.length });
      searchFrom = start + label.length;
    }
  }
  const target = placeholders.find((entry) => {
    if (key.name === "backspace") return beforeCursor === entry.end || (beforeCursor === entry.end + 1 && beforeText[entry.end] === " ");
    return beforeCursor === entry.start;
  });
  if (!target) return false;
  let deleteStart = target.start;
  let deleteEnd = target.end;
  if (beforeText[deleteEnd] === " ") deleteEnd += 1;
  else if (deleteStart > 0 && beforeText[deleteStart - 1] === " ") deleteStart -= 1;
  app.input.setText(beforeText.slice(0, deleteStart) + beforeText.slice(deleteEnd), false);
  app.input.setCursor(deleteStart);
  app.pendingImages = app.pendingImages.filter((image: { attachmentId?: string }, index: number) =>
    (image.attachmentId ?? String(index)) !== target.id,
  );
  ensureInlineChipElements(app);
  syncComposerAttachmentsFromInput(app);
  return true;
}

function tryRawDeleteFallback(app: AppState, key: Keypress, beforeText: string, beforeCursor: number): boolean {
  if (!((key.name === "backspace" || key.name === "delete") && !key.ctrl && !key.meta && !key.shift)) return false;
  if (key.name === "backspace") {
    if (beforeCursor <= 0) return false;
    app.input.setText(beforeText.slice(0, beforeCursor - 1) + beforeText.slice(beforeCursor), false);
    app.input.setCursor(beforeCursor - 1);
  } else {
    if (beforeCursor >= beforeText.length) return false;
    app.input.setText(beforeText.slice(0, beforeCursor) + beforeText.slice(beforeCursor + 1), false);
    app.input.setCursor(beforeCursor);
  }
  ensureInlineChipElements(app);
  syncComposerAttachmentsFromInput(app);
  return true;
}

export { handlePaste } from "./app-input-routes.js";

function getPointerPosition(key: Keypress): { col: number; row: number } | null {
  if (!key.char || !key.char.includes(",")) return null;
  const [colStr, rowStr] = key.char.split(",");
  const col = parseInt(colStr, 10);
  const row = parseInt(rowStr, 10);
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
  return { col, row };
}

function isSidebarPointer(app: AppState, key: Keypress): boolean {
  const pointer = getPointerPosition(key);
  if (!pointer || !app.shouldShowSidebar()) return false;
  return pointer.col > app.screen.mainWidth;
}

function scrollSidebarIfTargeted(app: AppState, delta: number, key?: Keypress): boolean {
  if (!app.screen.hasSidebar || getSettings().hideSidebar) return false;
  const pointerTargetsSidebar = !!key && isSidebarPointer(app, key);
  if (!app.sidebarFocused && !pointerTargetsSidebar) return false;
  const sidebarHeight = app.getSidebarViewportHeight();
  app.sidebarFocused = true;
  app.scrollSidebar(delta, sidebarHeight);
  return true;
}

function scrollTranscriptIfVisible(app: AppState, delta: number): boolean {
  if (app.messages.length === 0) return false;
  return app.scrollTranscript(delta);
}

function handleClickOrScroll(app: AppState, key: Keypress): boolean {
  if (key.name === "click" && key.char) {
    const pointer = getPointerPosition(key);
    if (!pointer) return false;
    if (isSidebarPointer(app, key)) {
      app.sidebarFocused = true;
      app.draw();
    } else {
      app.sidebarFocused = false;
      app.activeMenuClickTargets.get(pointer.row)?.();
    }
    return true;
  }
  if (key.name === "scrollup" || key.name === "scrolldown") {
    app.hideCursorBriefly();
    const delta = key.name === "scrollup" ? -3 : 3;
    if (scrollSidebarIfTargeted(app, delta, key)) {
      app.draw();
      return true;
    }
    if (!app.filePicker && !app.itemPicker && !app.settingsPicker && !app.modelPicker && !app.treeView && !app.questionView && scrollTranscriptIfVisible(app, delta)) {
      app.draw();
      return true;
    }
    return true;
  }
  if (key.name === "pageup" || (key.ctrl && key.name === "up")) {
    const menuDelta = -Math.max(1, app.screen.height - 8);
    app.hideCursorBriefly();
    if (app.scrollActiveMenu(menuDelta)) {
      app.draw();
      return true;
    }
    const pageDelta = -Math.max(1, app.getChatHeight() - 2);
    if (scrollSidebarIfTargeted(app, pageDelta)) {
      app.draw();
      return true;
    }
    if (scrollTranscriptIfVisible(app, pageDelta)) {
      app.draw();
      return true;
    }
    app.draw();
    return true;
  }
  if (key.name === "pagedown" || (key.ctrl && key.name === "down")) {
    const menuDelta = Math.max(1, app.screen.height - 8);
    app.hideCursorBriefly();
    if (app.scrollActiveMenu(menuDelta)) {
      app.draw();
      return true;
    }
    const pageDelta = Math.max(1, app.getChatHeight() - 2);
    if (scrollSidebarIfTargeted(app, pageDelta)) {
      app.draw();
      return true;
    }
    if (scrollTranscriptIfVisible(app, pageDelta)) {
      app.draw();
      return true;
    }
    app.draw();
    return true;
  }
  return false;
}

function handleEscapeAndBindings(app: AppState, key: Keypress): boolean {
  if (key.name === "escape" && app.sidebarFocused) {
    app.sidebarFocused = false;
    app.drawNow();
    return true;
  }
  if (key.meta && key.name === "up") {
    restoreQueuedMessage(app);
    return true;
  }
  if (key.name === "escape" && !app.isStreaming && app.hasPendingMessages() && app.input.getText().trim().length === 0) {
    app.clearPendingMessages();
    app.draw();
    return true;
  }
  if (key.name === "escape" && app.isStreaming && app.onAbort) {
    if (app.escPrimed) {
      app.clearInterruptPrompt();
      app.onAbort();
    } else {
      app.primeEscapeAbort();
    }
    return true;
  }
  if (key.ctrl && key.name === "c") {
    app.ctrlCCount++;
    if (app.ctrlCCount >= 2) {
      app.stop();
      return true;
    }
    app.primeCtrlCExit();
    return true;
  }
  app.clearInterruptPrompt();

  const bindings = loadKeybindings();
  if (matchesBinding(bindings.modelPicker, key)) {
    app.onSubmit?.("/model");
    return true;
  }
  if (matchesBinding(bindings.cycleScopedModel, key)) {
    app.onCycleScopedModel?.();
    return true;
  }
  return false;
}

export function handleKey(app: AppState, key: Keypress): void {
  ensureInlineChipElements(app);

  const preText = app.input.getText();
  const preCursor = app.input.getCursor();
  if (tryDeleteVisiblePlaceholderFallback(app, key, preText, preCursor)) {
    app.draw();
    return;
  }

  const shouldPreserveFilePickerForPointerEvent =
    key.name === "scrollup"
    || key.name === "scrolldown"
    || key.name === "click";
  if (app.filePicker && !shouldPreserveFilePickerForPointerEvent && !shouldKeepFilePickerOpen(app)) {
    app.filePicker = null;
  }

  if (app.budgetView) {
    handleBudgetViewKey(app, key);
    return;
  }

  if (app.isCompacting) {
    if (key.ctrl && key.name === "c") {
      app.ctrlCCount++;
      if (app.ctrlCCount >= 2) { app.stop(); return; }
      app.primeCtrlCExit();
      return;
    }
  }

  if (handleClickOrScroll(app, key)) return;

  if (app.questionView) {
    handleQuestionViewKey(app, key);
    return;
  }

  if (app.treeView) {
    handleTreeViewKey(app, key);
    return;
  }

  if (app.settingsPicker || app.itemPicker || app.modelPicker) {
    handlePickerKey(app, key);
    return;
  }

  if (app.filePicker) {
    handleFilePickerKey(app, key);
    return;
  }

  if (app.btwBubble) {
    const dismissWithInputlessKey = app.input.getText().trim().length === 0
      && !key.ctrl
      && !key.meta
      && !key.shift
      && (key.name === "space" || key.name === "return" || key.name === "enter");
    if (key.name === "escape" || dismissWithInputlessKey) {
      app.dismissBtwBubble();
      return;
    }
  }

  if (handleEscapeAndBindings(app, key)) return;

  if (key.name === "backspace" && !key.ctrl && !key.meta && !key.shift && app.input.getText().length === 0) {
    const fileKeys = Array.from(app.fileContexts.keys());
    if (fileKeys.length > 0) {
      app.fileContexts.delete(fileKeys[fileKeys.length - 1]!);
      app.draw();
      return;
    }
    if (app.pendingImages.length > 0) {
      app.pendingImages.pop();
      app.draw();
      return;
    }
  }

  if (key.ctrl && key.name === "o") {
    app.allToolsExpanded = !app.allToolsExpanded;
    app.toolOutputCollapsed = !app.allToolsExpanded;
    for (const tc of app.toolExecutions) tc.expanded = app.allToolsExpanded;
    app.invalidateMsgCache();
    app.draw();
    return;
  }

  if (key.shift && key.name === "tab") {
    app.mode = app.mode === "build" ? "plan" : "build";
    if (app.onModeChange) app.onModeChange(app.mode);
    app.draw();
    return;
  }
  if (key.ctrl && key.name === "t") {
    app.cycleThinkingMode();
    return;
  }
  if (key.ctrl && key.name === "y") {
    app.cycleCavemanMode();
    return;
  }

  if ((app.isStreaming || app.isCompacting) && app.input.getText().trim().length > 0) {
    if (key.name === "tab") {
      queueCurrentInput(app, "followup");
      return;
    }
    if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
      queueCurrentInput(app, "steering");
      return;
    }
  }

  const inputText = app.input.getText();
  if (inputText.startsWith("/")) {
    const suggestions = app.getCommandMatches();
    if (suggestions.length > 0) {
      if (key.name === "up") {
        app.cmdSuggestionCursor = Math.max(0, app.cmdSuggestionCursor - 1);
        app.draw();
        return;
      }
      if (key.name === "down") {
        app.cmdSuggestionCursor = Math.min(suggestions.length - 1, app.cmdSuggestionCursor + 1);
        app.draw();
        return;
      }
      if (key.name === "tab" || ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl)) {
        app.applyCommandSuggestion(app.cmdSuggestionCursor, key.name === "return");
        return;
      }
    }
  } else {
    app.cmdSuggestionCursor = 0;
  }

  const beforeText = app.input.getText();
  const beforeCursor = app.input.getCursor();
  const action = app.input.handleKey(key);
  if (action === "none" && key.char === " " && beforeText.startsWith("/") && !beforeText.includes(" ")) {
    const canonical = canonicalizeSlashInput(app.input.getText(), {
      hasMessages: app.messages.length > 0,
      hasAssistantContent: !!app.getLastAssistantContent?.(),
      canResume: true,
      hasStoredAuth: true,
    });
    if (canonical !== app.input.getText()) {
      app.input.setText(canonical, false);
      app.input.setCursor(canonical.length);
    }
  }
  if (action === "none") syncComposerAttachmentsFromInput(app);
  if (action === "none" && app.input.getText() === beforeText && app.input.getCursor() === beforeCursor && tryDeleteVisiblePlaceholderFallback(app, key, beforeText, beforeCursor)) {
    app.draw();
    return;
  }
  if (action === "none" && app.input.getText() === beforeText && app.input.getCursor() === beforeCursor && tryRawDeleteFallback(app, key, beforeText, beforeCursor)) {
    app.draw();
    return;
  }
  if (action === "none" && tryConsumeImageDraft(app)) {
    app.draw();
    return;
  }
  if (action === "none") scheduleDeferredImageDraftConsume(app);
  if (action === "submit") {
    submitInput(app);
  }

  if (key.char === "@" && !app.filePicker) {
    if (!app.projectFiles) app.projectFiles = collectProjectFiles(app.cwd);
    app.filePicker = {
      files: app.projectFiles,
      filtered: app.projectFiles,
      query: "",
      cursor: 0,
    };
  }
  app.draw();
}
