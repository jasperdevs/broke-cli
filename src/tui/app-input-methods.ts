import stripAnsi from "strip-ansi";
import { collectProjectFiles } from "./file-picker.js";
import type { Keypress } from "./keypress.js";
import { matchesBinding, loadKeybindings } from "../core/keybindings.js";
import { getSettings } from "../core/config.js";
import { handleQuestionViewKey } from "./question-view.js";
import {
  handleBudgetViewKey,
  handleFilePickerKey,
  handlePaste,
  handlePickerKey,
  handleTreeViewKey,
  queueCurrentInput,
  restoreQueuedMessage,
  submitInput,
} from "./app-input-routes.js";

type AppState = any;

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
      const sidebarLines = app.renderSidebar(app.getSidebarViewportHeight());
      const clickedLine = pointer.row <= sidebarLines.length ? sidebarLines[pointer.row - 1] : undefined;
      if (clickedLine) {
        const plain = stripAnsi(clickedLine).trim();
        if (plain.startsWith("▾ Files") || plain.startsWith("▸ Files")) {
          app.sidebarTreeOpen = !app.sidebarTreeOpen;
        } else if (plain.match(/^[▾▸] .+\/$/)) {
          const dirName = plain.slice(2).replace(/\/$/, "");
          if (app.sidebarExpandedDirs.has(dirName)) app.sidebarExpandedDirs.delete(dirName);
          else app.sidebarExpandedDirs.add(dirName);
        } else if (plain.match(/^▸ \+\d+ more$/)) {
          for (let i = pointer.row - 2; i >= 0; i--) {
            const prevPlain = stripAnsi(sidebarLines[i] ?? "").trim();
            if (prevPlain.match(/^▾ .+\/$/)) {
              const dirName = prevPlain.slice(2).replace(/\/$/, "");
              app.sidebarExpandedDirs.add(`${dirName}:all`);
              break;
            }
          }
        }
      }
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
  if (key.name === "escape" && !app.isStreaming && !app.hasPendingMessages() && app.input.getText().trim().length === 0) {
    if (app.escPrimed) {
      app.clearInterruptPrompt();
      app.onSubmit?.("/tree");
    } else {
      app.primeEscapeTree();
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

  if (handleEscapeAndBindings(app, key)) return;

  if (key.ctrl && key.name === "o") {
    app.allToolsExpanded = !app.allToolsExpanded;
    app.toolOutputCollapsed = !app.allToolsExpanded;
    for (const tc of app.toolCallGroups) tc.expanded = app.allToolsExpanded;
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

  const action = app.input.handleKey(key);
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
