import { existsSync, readFileSync } from "fs";
import stripAnsi from "strip-ansi";
import { collectProjectFiles, filterFiles } from "./file-picker.js";
import { renderBudgetDashboard } from "../core/budget-insights.js";
import type { Keypress } from "./keypress.js";
import { matchesBinding, loadKeybindings } from "../core/keybindings.js";
import { getSettings } from "../core/config.js";
import { DIM, RESET } from "../utils/ansi.js";
import { T } from "./app-shared.js";
import { handleQuestionViewKey } from "./question-view.js";

type AppState = any;

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

function handleBudgetViewKey(app: AppState, key: Keypress): void {
  const page = Math.max(1, app.screen.height - 7);
  const report = app.budgetView.reports[app.budgetView.scope];
  const lineCount = renderBudgetDashboard({
    report,
    width: Math.max(20, app.screen.width - 4),
    scopeLabel: app.budgetView.scope === "all" ? "all sessions" : "current session",
    contextTokens: app.contextTokenCount,
    contextLimit: app.contextLimitTokens,
    showContext: app.budgetView.scope === "session",
  }).length;
  const maxScroll = Math.max(0, lineCount - Math.max(1, app.screen.height - 6));
  if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
    app.closeBudgetView();
    return;
  }
  if (key.name === "tab") {
    app.budgetView.scope = app.budgetView.scope === "all" ? "session" : "all";
    app.budgetView.scrollOffset = 0;
    app.drawNow();
    return;
  }
  if (key.name === "up" || key.name === "scrollup") {
    app.budgetView.scrollOffset = Math.max(0, app.budgetView.scrollOffset - 1);
    app.draw();
    return;
  }
  if (key.name === "down" || key.name === "scrolldown") {
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

function handleAgentRunViewKey(app: AppState, key: Keypress): void {
  const runCount = app.agentRunView.runs.length;
  if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
    app.closeAgentRunsView();
    return;
  }
  if (runCount === 0) return;
  if (key.name === "up") {
    app.agentRunView.selectedIndex = Math.max(0, app.agentRunView.selectedIndex - 1);
    app.draw();
    return;
  }
  if (key.name === "down") {
    app.agentRunView.selectedIndex = Math.min(runCount - 1, app.agentRunView.selectedIndex + 1);
    app.draw();
    return;
  }
  if (key.name === "home") {
    app.agentRunView.selectedIndex = 0;
    app.draw();
    return;
  }
  if (key.name === "end") {
    app.agentRunView.selectedIndex = runCount - 1;
    app.draw();
    return;
  }
}

function handlePickerKey(app: AppState, key: Keypress): void {
  if (app.settingsPicker) {
    const filtered = app.getFilteredSettings();
    if (key.name === "up") app.settingsPicker.cursor = Math.max(0, app.settingsPicker.cursor - 1);
    else if (key.name === "down") app.settingsPicker.cursor = Math.min(filtered.length - 1, app.settingsPicker.cursor + 1);
    else if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) app.toggleSettingEntry(app.settingsPicker.cursor);
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
    if (key.name === "up") app.itemPicker.cursor = Math.max(0, app.itemPicker.cursor - 1);
    else if (key.name === "down") app.itemPicker.cursor = Math.min(filtered.length - 1, app.itemPicker.cursor + 1);
    else if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
      app.selectItemEntry(app.itemPicker.cursor);
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
    const filtered = app.getFilteredModels();
    if (key.name === "up") app.modelPicker.cursor = Math.max(0, app.modelPicker.cursor - 1);
    else if (key.name === "down") app.modelPicker.cursor = Math.min(filtered.length - 1, app.modelPicker.cursor + 1);
    else if (key.name === "tab") app.toggleModelScope();
    else if (key.name === "space") app.toggleModelPin(app.modelPicker.cursor);
    else if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
      app.selectModelEntry(app.modelPicker.cursor);
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

function handleFilePickerKey(app: AppState, key: Keypress): void {
  if (key.name === "up") app.filePicker.cursor = Math.max(0, app.filePicker.cursor - 1);
  else if (key.name === "down") app.filePicker.cursor = Math.min(app.filePicker.filtered.length - 1, app.filePicker.cursor + 1);
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

function submitInput(app: AppState): void {
  submitQueuedInput(app, "steering");
}

function submitQueuedInput(app: AppState, delivery: "steering" | "followup"): void {
  const text = app.input.submit();
  const images = app.takePendingImages();
  if (!text || !app.onSubmit) return;
  if (!app.isStreaming) {
    if (images.length > 0) (app.onSubmit as (text: string, images?: Array<{ mimeType: string; data: string }>) => void)(text, images);
    else app.onSubmit(text);
    return;
  }
  app.addPendingMessage(text, images, delivery);
  app.draw();
}

function queueCurrentInput(app: AppState, delivery: "steering" | "followup"): void {
  submitQueuedInput(app, delivery);
}

function restoreQueuedMessage(app: AppState): void {
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
  if (text.startsWith("data:image/")) {
    const match = text.match(/^data:image\/(\w+);base64,(.+)$/);
    if (match) {
      const mimeType = `image/${match[1]}`;
      const data = match[2];
      app.pendingImages.push({ mimeType, data });
      app.statusMessage = `${T()}✓ Image attached (${mimeType})${RESET}`;
      setTimeout(() => { app.statusMessage = undefined; app.draw(); }, 1500);
      app.draw();
      return;
    }
  }

  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
  const trimmed = text.trim();
  const isImagePath = imageExtensions.some((ext) => trimmed.toLowerCase().endsWith(ext));
  if (isImagePath && (trimmed.includes("/") || trimmed.includes("\\"))) {
    try {
      if (existsSync(trimmed)) {
        const data = readFileSync(trimmed);
        const ext = trimmed.split(".").pop()?.toLowerCase() || "png";
        const mimeType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        const base64 = data.toString("base64");
        app.pendingImages.push({ mimeType, data: base64 });
        app.input.paste(` ${T()}[IMAGE ${app.pendingImages.length}]${RESET} `);
        app.statusMessage = `${T()}✓ Image loaded${RESET}`;
        setTimeout(() => { app.statusMessage = undefined; app.draw(); }, 1500);
        app.draw();
        return;
      }
    } catch {}
  }
  app.input.paste(text);
  app.draw();
}
