import stripAnsi from "strip-ansi";
import { collectProjectFiles } from "./file-picker.js";
import type { Keypress } from "./keypress.js";
import { matchesBinding, loadKeybindings } from "../core/keybindings.js";
import { getSettings } from "../core/config.js";
import { handleQuestionViewKey } from "./question-view.js";
import {
  handleAgentRunViewKey,
  handleBudgetViewKey,
  handleFilePickerKey,
  handlePaste,
  handlePickerKey,
  queueCurrentInput,
  restoreQueuedMessage,
  submitInput,
} from "./app-input-routes.js";

type AppState = any;

export { handlePaste } from "./app-input-routes.js";

export function handleKey(app: AppState, key: Keypress): void {
  if (app.budgetView) {
    handleBudgetViewKey(app, key);
    return;
  }
  if (app.agentRunView) {
    handleAgentRunViewKey(app, key);
    return;
  }

  if (app.isCompacting) {
    if (key.ctrl && key.name === "c") {
      app.ctrlCCount++;
      if (app.ctrlCCount >= 2) { app.stop(); return; }
      app.primeCtrlCExit();
    }
    return;
  }

  if (key.name === "click" && key.char) {
    const [colStr, rowStr] = key.char.split(",");
    const col = parseInt(colStr, 10);
    const row = parseInt(rowStr, 10);
    if (app.shouldShowSidebar() && col > app.screen.mainWidth) {
      app.sidebarFocused = true;
      const sidebarLines = app.renderSidebar(app.getChatHeight());
      const clickedLine = row <= sidebarLines.length ? sidebarLines[row - 1] : undefined;
      if (clickedLine) {
        const plain = stripAnsi(clickedLine).trim();
        if (plain.startsWith("▾ Files") || plain.startsWith("▸ Files")) {
          app.sidebarTreeOpen = !app.sidebarTreeOpen;
        } else if (plain.match(/^[▾▸] .+\/$/)) {
          const dirName = plain.slice(2).replace(/\/$/, "");
          if (app.sidebarExpandedDirs.has(dirName)) app.sidebarExpandedDirs.delete(dirName);
          else app.sidebarExpandedDirs.add(dirName);
        } else if (plain.match(/^▸ \+\d+ more$/)) {
          for (let i = row - 2; i >= 0; i--) {
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
      const menuAction = app.activeMenuClickTargets.get(row);
      if (menuAction) menuAction();
    }
    return;
  }

  if (key.name === "scrollup" || key.name === "scrolldown") {
    const delta = key.name === "scrollup" ? -3 : 3;
    app.hideCursorBriefly();
    if (app.sidebarFocused && app.screen.hasSidebar && !getSettings().hideSidebar) {
      app.scrollSidebar(delta, app.getChatHeight());
    } else if (!app.scrollActiveMenu(key.name === "scrollup" ? -1 : 1)) {
      app.scrollTranscript(delta);
    }
    app.draw();
    return;
  }

  if (key.name === "pageup" || (key.ctrl && key.name === "up")) {
    app.hideCursorBriefly();
    app.scrollOffset = Math.max(0, app.scrollOffset - 3);
    app.invalidateMsgCache();
    app.draw();
    return;
  }
  if (key.name === "pagedown" || (key.ctrl && key.name === "down")) {
    app.hideCursorBriefly();
    const chatHeight = app.getChatHeight();
    const messageLines = app.renderMessages(app.screen.mainWidth - 2);
    const maxScroll = Math.max(0, messageLines.length - chatHeight);
    app.scrollOffset = Math.min(maxScroll, app.scrollOffset + 3);
    app.invalidateMsgCache();
    app.draw();
    return;
  }

  if (app.questionView) {
    handleQuestionViewKey(app, key);
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

  if (key.name === "escape" && app.sidebarFocused) {
    app.sidebarFocused = false;
    app.drawNow();
    return;
  }

  if (key.meta && key.name === "up") {
    restoreQueuedMessage(app);
    return;
  }

  if (key.name === "escape" && !app.isStreaming && app.hasPendingMessages() && app.input.getText().trim().length === 0) {
    app.clearPendingMessages();
    app.draw();
    return;
  }

  if (key.name === "escape" && app.isStreaming && app.onAbort) {
    if (app.escPrimed) {
      app.clearInterruptPrompt();
      app.onAbort();
    } else {
      app.primeEscapeAbort();
    }
    return;
  }

  if (key.ctrl && key.name === "c") {
    app.ctrlCCount++;
    if (app.ctrlCCount >= 2) { app.stop(); return; }
    app.primeCtrlCExit();
    return;
  }
  app.clearInterruptPrompt();

  const bindings = loadKeybindings();
  if (matchesBinding(bindings.modelPicker, key)) {
    if (app.onSubmit) app.onSubmit("/model");
    return;
  }
  if (matchesBinding(bindings.agentsView, key)) {
    if (app.onSubmit) app.onSubmit("/agents");
    return;
  }
  if (matchesBinding(bindings.cycleScopedModel, key)) {
    if (app.onCycleScopedModel) app.onCycleScopedModel();
    return;
  }

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

  if (app.isStreaming && app.input.getText().trim().length > 0) {
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
