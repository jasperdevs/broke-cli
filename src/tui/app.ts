import { Screen } from "./screen.js";
import { KeypressHandler, type Keypress } from "./keypress.js";
import { InputWidget } from "./input.js";
import { GRAY, RESET, BOLD, DIM, RED, WHITE, GREEN, YELLOW, bg, moveTo } from "../utils/ansi.js";
import { currentTheme, getPlanColor } from "../core/themes.js";
import { execSync } from "child_process";
import { matchesBinding, loadKeybindings } from "../core/keybindings.js";
import { getSettings } from "../core/config.js";
import type { Mode } from "../core/config.js";
import stripAnsi from "strip-ansi";
import { renderMarkdown } from "../utils/markdown.js";
import { collectProjectFiles, filterFiles, readFileForContext } from "./file-picker.js";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  images?: Array<{ mimeType: string; data: string }>;
}

interface ModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  active: boolean;
  isHeader?: boolean;
}

export interface SettingEntry {
  key: string;
  label: string;
  value: string;
  description: string;
}

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
}

/** Shorthand for theme primary color — called per-render so theme switches take effect. */
function T(): string { return currentTheme().primary; }

/** Shorthand for plan mode color (yellow/amber). */
function P(): string { return getPlanColor(); }

/** Format token count: 0, 142, 3.2k, 1.5M */
function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Format cost: $0.00, $0.0012, $1.23 */
function fmtCost(c: number): string {
  if (c === 0) return "$0.00";
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

/** Bouncing dot animation: green dot slides across dim dots */
function bounceDot(frame: number, len = 4): string {
  // Bounce: 0,1,2,3,2,1,0,1,...
  const cycle = (len - 1) * 2;
  const pos = frame % cycle;
  const idx = pos < len ? pos : cycle - pos;
  let s = "";
  for (let i = 0; i < len; i++) {
    s += i === idx ? `${GREEN}\u2022${RESET}` : `${DIM}\u00B7${RESET}`;
  }
  return s;
}

const COMMANDS = [
  { name: "model", desc: "switch model" },
  { name: "settings", desc: "configure options" },
  { name: "compact", desc: "compress context" },
  { name: "sessions", desc: "recent sessions" },
  { name: "new", desc: "new session" },
  { name: "name", desc: "name this session" },
  { name: "export", desc: "export to markdown" },
  { name: "copy", desc: "copy last response" },
  { name: "undo", desc: "undo last change" },
  { name: "resume", desc: "resume session" },
  { name: "reload", desc: "reload context" },
  { name: "cost", desc: "session spend" },
  { name: "clear", desc: "clear chat" },
  { name: "exit", desc: "quit" },
];

export class App {
  private screen: Screen;
  private keypress: KeypressHandler;
  private input: InputWidget;
  private messages: ChatMessage[] = [];
  private thinkingBuffer = "";
  private sessionCost = 0;
  private sessionTokens = 0;
  private contextUsed = 0;
  private modelName = "none";
  private providerName = "---";
  private isStreaming = false;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private ctrlCCount = 0;
  private ctrlCTimeout: ReturnType<typeof setTimeout> | null = null;
  private scrollOffset = 0;
  private onSubmit: ((text: string) => void) | null = null;
  private onAbort: (() => void) | null = null;
  private running = false;
  private statusMessage: string | undefined;
  private detectedProviders: string[] = [];
  private cwd = process.cwd();
  private modelPicker: { options: ModelOption[]; cursor: number; query: string } | null = null;
  private onModelSelect: ((providerId: string, modelId: string) => void) | null = null;
  private onModelPin: ((providerId: string, modelId: string, pinned: boolean) => void) | null = null;
  private settingsPicker: { entries: SettingEntry[]; cursor: number; query: string } | null = null;
  private onSettingToggle: ((key: string) => void) | null = null;
  private filePicker: { files: string[]; filtered: string[]; query: string; cursor: number } | null = null;
  private projectFiles: string[] | null = null;
  private fileContexts: Map<string, string> = new Map();
  private cmdSuggestionCursor = 0;
  private itemPicker: { title: string; items: PickerItem[]; cursor: number; query: string } | null = null;
  private onItemSelect: ((id: string) => void) | null = null;
  private toolOutputCollapsed = false;
  private pendingImages: Array<{ mimeType: string; data: string }> = [];
  private gitBranch = "";
  private gitDirty = false;
  private onCycleScopedModel: (() => void) | null = null;
  private mode: Mode = "build";
  private onModeChange: ((mode: Mode) => void) | null = null;
  private pendingMessages: Array<{ text: string; images?: Array<{ mimeType: string; data: string }> }> = [];
  private onPendingMessagesReady: (() => void) | null = null;
  private streamStartTime = 0;
  private streamTokens = 0;
  private toolCallGroups: Array<{ name: string; preview: string; args?: unknown; resultDetail?: string; result?: string; error?: boolean }> = [];
  private isCompacting = false;
  private compactStartTime = 0;
  private compactTokens = 0;

  // Render throttling
  private drawScheduled = false;
  private lastDrawTime = 0;
  private static readonly DRAW_THROTTLE_MS = 16; // ~60fps cap

  // Message render cache (invalidated on message change or width change)
  private msgCacheWidth = 0;
  private msgCacheLen = 0;
  private msgCacheLines: string[] | null = null;

  constructor() {
    this.screen = new Screen();
    this.input = new InputWidget();
    this.keypress = new KeypressHandler(
      (key) => this.handleKey(key),
      (text) => this.handlePaste(text),
    );
  }

  /** Invalidate the message render cache */
  private invalidateMsgCache(): void {
    this.msgCacheLines = null;
  }

  setModel(provider: string, model: string): void {
    this.providerName = provider;
    // Shorten long model names (e.g. ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M -> gemma-4-E4B-it:Q4_K_M)
    if (model.includes("/")) {
      const parts = model.split("/");
      model = parts[parts.length - 1];
    }
    if (model.includes("-GGUF")) {
      model = model.replace(/-GGUF/g, "");
    }
    this.modelName = model;
    this.draw();
  }

  updateCost(cost: number, tokens: number): void {
    this.sessionCost = cost;
    this.sessionTokens = tokens;
    this.draw();
  }

  resetCost(): void {
    this.sessionCost = 0;
    this.sessionTokens = 0;
    this.contextUsed = 0;
    this.draw();
  }

  setContextUsed(pct: number): void {
    this.contextUsed = pct;
    this.draw();
  }

  setStreaming(streaming: boolean): void {
    this.isStreaming = streaming;
    if (!streaming) {
      this.thinkingBuffer = "";
      // Collapse tool call groups into single summary message
      if (this.toolCallGroups.length > 0) {
        this.collapseToolCalls();
      }
      // Show completion message with elapsed time
      if (this.streamStartTime > 0) {
        const elapsed = Date.now() - this.streamStartTime;
        const secs = Math.floor(elapsed / 1000);
        if (secs >= 2) {
          const mins = Math.floor(secs / 60);
          const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
          const doneVerbs = ["Churned", "Cooked", "Brewed", "Hammered", "Crunched", "Wrapped up"];
          const verb = doneVerbs[Math.floor(Math.random() * doneVerbs.length)];
          this.messages.push({ role: "system", content: `${T()}\u25C9${RESET} ${DIM}${verb} for ${timeStr}${RESET}` });
          this.invalidateMsgCache();
        }
        this.streamStartTime = 0;
      }
    }
    if (streaming) {
      this.spinnerFrame = 0;
      this.streamStartTime = Date.now();
      this.streamTokens = 0;
      this.toolCallGroups = [];
      this.spinnerTimer = setInterval(() => {
        this.spinnerFrame++;
        this.draw();
      }, 150);
    } else if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    this.invalidateMsgCache();
    this.draw();
  }

  setDetectedProviders(providers: string[]): void {
    this.detectedProviders = providers;
  }

  openModelPicker(options: ModelOption[], onSelect: (providerId: string, modelId: string) => void, onPin?: (providerId: string, modelId: string, pinned: boolean) => void, initialCursor?: number): void {
    const cursorIdx = initialCursor ?? options.findIndex((o) => o.active);
    this.modelPicker = { options, cursor: cursorIdx >= 0 ? cursorIdx : 0, query: "" };
    this.onModelSelect = onSelect;
    this.onModelPin = onPin ?? null;
    this.draw();
  }

  openSettings(entries: SettingEntry[], onToggle: (key: string) => void): void {
    this.settingsPicker = { entries, cursor: 0, query: "" };
    this.onSettingToggle = onToggle;
    this.draw();
  }

  updateSettings(entries: SettingEntry[]): void {
    if (this.settingsPicker) {
      this.settingsPicker.entries = entries;
      this.draw();
    }
  }

  openItemPicker(title: string, items: PickerItem[], onSelect: (id: string) => void): void {
    this.itemPicker = { title, items, cursor: 0, query: "" };
    this.onItemSelect = onSelect;
    this.draw();
  }

  clearMessages(): void {
    this.messages = [];
    this.scrollOffset = 0;
    this.invalidateMsgCache();
    this.screen.forceRedraw([]);
    this.draw();
  }

  addMessage(role: "user" | "assistant" | "system", content: string, images?: Array<{ mimeType: string; data: string }>): void {
    this.messages.push({ role, content, images });
    this.invalidateMsgCache();
    this.scrollToBottom();
    this.draw();
  }

  appendToLastMessage(text: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === "assistant") {
      last.content += text;
    } else {
      this.messages.push({ role: "assistant", content: text });
    }
    this.invalidateMsgCache();
    this.scrollToBottom();
    this.draw();
  }

  appendThinking(delta: string): void {
    this.thinkingBuffer += delta;
    this.scrollToBottom();
    this.draw();
  }

  /** Track a tool call (shown inline during streaming, collapsed after) */
  addToolCall(name: string, preview: string, args?: unknown): void {
    this.toolCallGroups.push({ name, preview, args });
    this.invalidateMsgCache();
    this.scrollToBottom();
    this.draw();
  }

  /** Track a tool result for the last tool call */
  addToolResult(name: string, result: string, error?: boolean, resultDetail?: string): void {
    // Find last matching tool call without a result
    for (let i = this.toolCallGroups.length - 1; i >= 0; i--) {
      if (this.toolCallGroups[i].name === name && !this.toolCallGroups[i].result) {
        this.toolCallGroups[i].result = result;
        this.toolCallGroups[i].error = error;
        this.toolCallGroups[i].resultDetail = resultDetail;
        break;
      }
    }
    this.invalidateMsgCache();
    this.scrollToBottom();
    this.draw();
  }

  setStreamTokens(tokens: number): void {
    this.streamTokens = tokens;
  }

  setCompacting(compacting: boolean, tokenCount?: number): void {
    this.isCompacting = compacting;
    if (compacting) {
      this.compactStartTime = Date.now();
      this.compactTokens = tokenCount ?? 0;
      if (!this.spinnerTimer) {
        this.spinnerFrame = 0;
        this.spinnerTimer = setInterval(() => {
          this.spinnerFrame++;
          this.draw();
        }, 150);
      }
    } else if (!this.isStreaming && this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    this.draw();
  }

  /** Collapse tool calls into a compact summary after streaming ends */
  private collapseToolCalls(): void {
    if (this.toolCallGroups.length === 0) return;

    // Compact one-line summary grouped by type
    const reads: string[] = [];
    const writes: string[] = [];
    const edits: string[] = [];
    const cmds: string[] = [];
    const errors: string[] = [];

    for (const tc of this.toolCallGroups) {
      if (tc.error && tc.result) { errors.push(tc.result); continue; }
      switch (tc.name) {
        case "readFile": case "listFiles": case "grep": reads.push(tc.preview); break;
        case "writeFile": writes.push(tc.preview); break;
        case "editFile": edits.push(tc.preview); break;
        case "bash": cmds.push(tc.preview); break;
      }
    }

    const parts: string[] = [];
    if (reads.length > 0) parts.push(`${DIM}read ${reads.length} file${reads.length > 1 ? "s" : ""}${RESET}`);
    for (const w of writes) parts.push(`${GREEN}wrote${RESET} ${DIM}${w}${RESET}`);
    for (const e of edits) parts.push(`${GREEN}edited${RESET} ${DIM}${e}${RESET}`);
    for (const c of cmds) parts.push(`${DIM}ran${RESET} ${DIM}${c}${RESET}`);
    for (const e of errors) parts.push(`${RED}${e}${RESET}`);

    if (parts.length > 0) {
      this.messages.push({ role: "system", content: parts.join("  ") });
    }

    this.toolCallGroups = [];
  }

  getLastAssistantContent(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") return this.messages[i].content;
    }
    return "";
  }

  getFileContexts(): Map<string, string> {
    const ctx = new Map(this.fileContexts);
    this.fileContexts.clear();
    return ctx;
  }

  setStatus(message: string): void {
    this.statusMessage = message;
    this.draw();
  }

  clearStatus(): void {
    this.statusMessage = undefined;
    this.draw();
  }

  getMode(): Mode {
    return this.mode;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.draw();
  }

  onModeToggle(callback: (mode: Mode) => void): void {
    this.onModeChange = callback;
  }

  private scrollToBottom(): void {
    const chatHeight = this.getChatHeight();
    const messageLines = this.renderMessages(this.screen.mainWidth - 2);
    this.scrollOffset = Math.max(0, messageLines.length - chatHeight);
  }

  private getChatHeight(): number {
    const headerLines = this.screen.hasSidebar ? 0 : 1; // compact header when narrow
    // sep(1) + input(1) + sep(1) + info(1) + optional status + optional header
    const bottomBase = 4;
    const statusExtra = this.statusMessage ? 1 : 0;
    return this.screen.height - bottomBase - statusExtra - headerLines;
  }

  /** Filter model options by search query */
  private getFilteredModels(): ModelOption[] {
    if (!this.modelPicker) return [];
    const q = this.modelPicker.query.toLowerCase();
    if (!q) return this.modelPicker.options;
    return this.modelPicker.options.filter(o =>
      o.modelId.toLowerCase().includes(q) || o.providerName.toLowerCase().includes(q)
    );
  }

  /** Filter settings by search query */
  private getFilteredSettings(): SettingEntry[] {
    if (!this.settingsPicker) return [];
    const q = this.settingsPicker.query.toLowerCase();
    if (!q) return this.settingsPicker.entries;
    return this.settingsPicker.entries.filter(e =>
      e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    );
  }

  /** Filter items by search query */
  private getFilteredItems(): PickerItem[] {
    if (!this.itemPicker) return [];
    const q = this.itemPicker.query.toLowerCase();
    if (!q) return this.itemPicker.items;
    return this.itemPicker.items.filter(i =>
      i.label.toLowerCase().includes(q) || (i.detail ?? "").toLowerCase().includes(q)
    );
  }

  private handleKey(key: Keypress): void {
    // Settings picker (searchable)
    if (this.settingsPicker) {
      const filtered = this.getFilteredSettings();
      if (key.name === "up") {
        this.settingsPicker.cursor = Math.max(0, this.settingsPicker.cursor - 1);
        this.draw();
      } else if (key.name === "down") {
        this.settingsPicker.cursor = Math.min(filtered.length - 1, this.settingsPicker.cursor + 1);
        this.draw();
      } else if (key.name === "return" || key.name === "space") {
        const entry = filtered[this.settingsPicker.cursor];
        if (entry && this.onSettingToggle) this.onSettingToggle(entry.key);
        this.draw();
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.settingsPicker = null;
        this.draw();
      } else if (key.name === "backspace") {
        if (this.settingsPicker.query.length > 0) {
          this.settingsPicker.query = this.settingsPicker.query.slice(0, -1);
          this.settingsPicker.cursor = 0;
          this.draw();
        }
      } else if (key.char && !key.ctrl && !key.meta && key.char.length === 1) {
        this.settingsPicker.query += key.char;
        this.settingsPicker.cursor = 0;
        this.draw();
      }
      return;
    }

    // Item picker (searchable)
    if (this.itemPicker) {
      const filtered = this.getFilteredItems();
      if (key.name === "up") {
        this.itemPicker.cursor = Math.max(0, this.itemPicker.cursor - 1);
        this.draw();
      } else if (key.name === "down") {
        this.itemPicker.cursor = Math.min(filtered.length - 1, this.itemPicker.cursor + 1);
        this.draw();
      } else if (key.name === "return") {
        const item = filtered[this.itemPicker.cursor];
        if (item && this.onItemSelect) {
          this.onItemSelect(item.id);
        }
        this.itemPicker = null;
        this.draw();
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.itemPicker = null;
        this.draw();
      } else if (key.name === "backspace") {
        if (this.itemPicker.query.length > 0) {
          this.itemPicker.query = this.itemPicker.query.slice(0, -1);
          this.itemPicker.cursor = 0;
          this.draw();
        }
      } else if (key.char && !key.ctrl && !key.meta && key.char.length === 1) {
        this.itemPicker.query += key.char;
        this.itemPicker.cursor = 0;
        this.draw();
      }
      return;
    }

    // Model picker (searchable)
    if (this.modelPicker) {
      const filtered = this.getFilteredModels();
      if (key.name === "up") {
        this.modelPicker.cursor = Math.max(0, this.modelPicker.cursor - 1);
        this.draw();
      } else if (key.name === "down") {
        this.modelPicker.cursor = Math.min(filtered.length - 1, this.modelPicker.cursor + 1);
        this.draw();
      } else if (key.name === "tab") {
        // Tab to pin/unpin in model picker
        const opt = filtered[this.modelPicker.cursor];
        if (opt) {
          opt.active = !opt.active;
          if (this.onModelPin) this.onModelPin(opt.providerId, opt.modelId, opt.active);
        }
        this.draw();
      } else if (key.name === "return") {
        const selected = filtered[this.modelPicker.cursor];
        this.modelPicker = null;
        if (selected && this.onModelSelect) {
          this.onModelSelect(selected.providerId, selected.modelId);
        }
        this.draw();
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.modelPicker = null;
        this.draw();
      } else if (key.name === "backspace") {
        if (this.modelPicker.query.length > 0) {
          this.modelPicker.query = this.modelPicker.query.slice(0, -1);
          this.modelPicker.cursor = 0;
          this.draw();
        }
      } else if (key.char && !key.ctrl && !key.meta && key.char.length === 1) {
        this.modelPicker.query += key.char;
        this.modelPicker.cursor = 0;
        this.draw();
      }
      return;
    }

    // File picker (@file references)
    if (this.filePicker) {
      if (key.name === "up") {
        this.filePicker.cursor = Math.max(0, this.filePicker.cursor - 1);
        this.draw();
      } else if (key.name === "down") {
        this.filePicker.cursor = Math.min(this.filePicker.filtered.length - 1, this.filePicker.cursor + 1);
        this.draw();
      } else if (key.name === "return" || key.name === "tab") {
        const selected = this.filePicker.filtered[this.filePicker.cursor];
        if (selected) {
          // Replace @query with @filepath in input
          const text = this.input.getText();
          const atIdx = text.lastIndexOf("@");
          if (atIdx >= 0) {
            this.input.clear();
            this.input.paste(text.slice(0, atIdx) + `@${selected} `);
          }
          // Inject file contents as hidden context
          const content = readFileForContext(this.cwd, selected);
          this.fileContexts.set(selected, content);
        }
        this.filePicker = null;
        this.draw();
      } else if (key.name === "escape") {
        this.filePicker = null;
        this.draw();
      } else if (key.name === "backspace") {
        if (this.filePicker.query.length > 0) {
          this.filePicker.query = this.filePicker.query.slice(0, -1);
          this.filePicker.filtered = filterFiles(this.filePicker.files, this.filePicker.query);
          this.filePicker.cursor = 0;
          // Also update input
          this.input.handleKey(key);
          this.draw();
        } else {
          this.filePicker = null;
          this.input.handleKey(key);
          this.draw();
        }
      } else if (key.char && !key.ctrl && !key.meta) {
        this.filePicker.query += key.char;
        this.filePicker.filtered = filterFiles(this.filePicker.files, this.filePicker.query);
        this.filePicker.cursor = 0;
        this.input.handleKey(key);
        this.draw();
      }
      return;
    }

    // ESC to interrupt streaming (double-press)
    if (key.name === "escape" && this.isStreaming && this.onAbort) {
      this.ctrlCCount++;
      if (this.ctrlCCount >= 2) {
        this.onAbort();
        this.ctrlCCount = 0;
        return;
      }
      this.statusMessage = `${RED}Press esc again to interrupt${RESET}`;
      this.draw();
      if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
      this.ctrlCTimeout = setTimeout(() => {
        this.ctrlCCount = 0;
        this.statusMessage = undefined;
        this.draw();
      }, 1500);
      return;
    }

    if (key.ctrl && key.name === "c") {
      if (this.isStreaming && this.onAbort) {
        this.onAbort();
        this.ctrlCCount = 0;
        return;
      }
      this.ctrlCCount++;
      if (this.ctrlCCount >= 2) { this.stop(); return; }
      this.statusMessage = `${RED}Press Ctrl+C again to exit${RESET}`;
      this.draw();
      if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
      this.ctrlCTimeout = setTimeout(() => {
        this.ctrlCCount = 0;
        this.statusMessage = undefined;
        this.draw();
      }, 1500);
      return;
    }
    this.ctrlCCount = 0;

    // Keybinding: model picker (default Ctrl+L)
    const bindings = loadKeybindings();
    if (matchesBinding(bindings.modelPicker, key)) {
      if (this.onSubmit) this.onSubmit("/model");
      return;
    }

    // Keybinding: cycle scoped models (default Ctrl+P)
    if (matchesBinding(bindings.cycleScopedModel, key)) {
      if (this.onCycleScopedModel) this.onCycleScopedModel();
      return;
    }

    // Ctrl+O — toggle tool output collapse
    if (key.ctrl && key.name === "o") {
      this.toolOutputCollapsed = !this.toolOutputCollapsed;
      this.draw();
      return;
    }

    // Shift+Tab — toggle between build and plan mode
    if (key.shift && key.name === "tab") {
      this.mode = this.mode === "build" ? "plan" : "build";
      if (this.onModeChange) this.onModeChange(this.mode);
      this.draw();
      return;
    }

    if (key.name === "pageup") { this.scrollOffset = Math.max(0, this.scrollOffset - 5); this.draw(); return; }
    if (key.name === "pagedown") {
      const chatHeight = this.getChatHeight();
      const messageLines = this.renderMessages(this.screen.mainWidth - 2);
      const maxScroll = Math.max(0, messageLines.length - chatHeight);
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 5);
      this.draw();
      return;
    }

    // Command suggestion navigation when / is typed
    const inputText = this.input.getText();
    if (inputText.startsWith("/")) {
      const suggestions = this.getCommandMatches();
      if (suggestions.length > 0) {
        if (key.name === "up") {
          this.cmdSuggestionCursor = Math.max(0, this.cmdSuggestionCursor - 1);
          this.draw();
          return;
        }
        if (key.name === "down") {
          this.cmdSuggestionCursor = Math.min(suggestions.length - 1, this.cmdSuggestionCursor + 1);
          this.draw();
          return;
        }
        if (key.name === "tab" || key.name === "return") {
          const selected = suggestions[this.cmdSuggestionCursor];
          if (selected) {
            this.input.clear();
            this.input.paste(`/${selected.name}`);
            this.cmdSuggestionCursor = 0;
            // If it's a complete command, submit it
            if (key.name === "return") {
              const cmd = this.input.submit();
              if (cmd && this.onSubmit) this.onSubmit(cmd);
            }
          }
          this.draw();
          return;
        }
      }
    } else {
      this.cmdSuggestionCursor = 0;
    }

    const action = this.input.handleKey(key);
    if (action === "submit") {
      const text = this.input.submit();
      const images = this.takePendingImages();
      if (text && this.onSubmit) {
        const settings = getSettings();
        const followUpMode = settings.followUpMode;
        
        // If not streaming, always submit immediately
        // If streaming, check followUpMode
        if (!this.isStreaming) {
          // Not streaming - submit immediately
          if (images.length > 0) {
            (this.onSubmit as (text: string, images?: Array<{ mimeType: string; data: string }>) => void)(text, images);
          } else {
            this.onSubmit(text);
          }
        } else if (followUpMode === "immediate") {
          // Send immediately even while streaming
          if (images.length > 0) {
            (this.onSubmit as (text: string, images?: Array<{ mimeType: string; data: string }>) => void)(text, images);
          } else {
            this.onSubmit(text);
          }
        } else {
          // Queue the message for later (after_tool or after_response)
          this.addPendingMessage(text, images);
          this.statusMessage = `${T()}✓ Queued (${this.pendingMessages.length} pending)${RESET}`;
          setTimeout(() => { this.statusMessage = undefined; this.draw(); }, 1500);
          this.draw();
        }
      }
    }

    // Detect @ trigger for file picker
    if (key.char === "@" && !this.filePicker) {
      if (!this.projectFiles) {
        this.projectFiles = collectProjectFiles(this.cwd);
      }
      this.filePicker = {
        files: this.projectFiles,
        filtered: this.projectFiles.slice(0, 10),
        query: "",
        cursor: 0,
      };
    }

    this.draw();
  }

  private handlePaste(text: string): void {
    // Check if pasted content is a base64 image
    if (text.startsWith("data:image/")) {
      const match = text.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        const mimeType = `image/${match[1]}`;
        const data = match[2];
        this.pendingImages.push({ mimeType, data });
        this.statusMessage = `${T()}✓ Image attached (${mimeType})${RESET}`;
        setTimeout(() => { this.statusMessage = undefined; this.draw(); }, 1500);
        this.draw();
        return;
      }
    }
    // Check if pasted content is a file path (drag & drop)
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    const trimmed = text.trim();
    const isImagePath = imageExtensions.some(ext => trimmed.toLowerCase().endsWith(ext));
    
    if (isImagePath && (trimmed.includes('/') || trimmed.includes('\\'))) {
      // Try to read and convert the image file
      try {
        const { readFileSync, existsSync } = require("fs");
        if (existsSync(trimmed)) {
          const data = readFileSync(trimmed);
          const ext = trimmed.split('.').pop()?.toLowerCase() || 'png';
          const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          const base64 = data.toString('base64');
          this.pendingImages.push({ mimeType, data: base64 });
          // Insert inline tag in input
          const tag = ` ${T()}[IMAGE ${this.pendingImages.length}]${RESET} `;
          this.input.paste(tag);
          this.statusMessage = `${T()}✓ Image loaded${RESET}`;
          setTimeout(() => { this.statusMessage = undefined; this.draw(); }, 1500);
          this.draw();
          return;
        }
      } catch { /* fall through to normal paste */ }
    }
    this.input.paste(text);
    this.draw();
  }

  /** Check if a system message looks like tool output */
  private isToolOutput(content: string): boolean {
    return content.startsWith("> ") || content.startsWith("  ");
  }

  /** Render static message lines (cached when unchanged) */
  private renderStaticMessages(maxWidth: number): string[] {
    // Return cache if valid
    if (this.msgCacheLines && this.msgCacheWidth === maxWidth && this.msgCacheLen === this.messages.length) {
      return this.msgCacheLines;
    }
    const lines: string[] = [];
    let idx = 0;
    while (idx < this.messages.length) {
      const msg = this.messages[idx];
      if (msg.role === "user") {
        let content = msg.content;
        if (msg.images && msg.images.length > 0) {
          for (let i = 0; i < msg.images.length; i++) {
            const tag = `${bg(58, 199, 58)}${BOLD}${WHITE}[IMAGE ${i + 1}]${RESET}`;
            content += ` ${tag}`;
          }
        }
        lines.push(`${bg(30, 30, 30)}${BOLD}${WHITE}  > ${content}${" ".repeat(Math.max(0, maxWidth - stripAnsi(content).length - 4))}${RESET}`);
        lines.push("");
      } else if (msg.role === "assistant") {
        const rendered = renderMarkdown(msg.content);
        const wrapW = maxWidth - 6; // 4 indent + 2 margin
        for (const cl of rendered.split("\n")) {
          const visLen = stripAnsi(cl).length;
          if (visLen <= wrapW) {
            lines.push(`    ${cl}`);
          } else {
            // Soft wrap long lines
            const plain = stripAnsi(cl);
            for (let i = 0; i < plain.length; i += wrapW) {
              lines.push(`    ${plain.slice(i, i + wrapW)}`);
            }
          }
        }
        if (idx + 1 < this.messages.length && this.messages[idx + 1].role === "user") {
          lines.push("");
          lines.push(`${DIM}  ${"─".repeat(Math.min(40, maxWidth - 4))}${RESET}`);
        }
      } else if (this.toolOutputCollapsed && this.isToolOutput(msg.content)) {
        while (idx + 1 < this.messages.length
          && this.messages[idx + 1].role === "system"
          && this.isToolOutput(this.messages[idx + 1].content)) {
          idx++;
        }
        lines.push(`${DIM}  [tool output hidden]${RESET}`);
      } else if (msg.content.includes("\x1b[")) {
        // Pre-formatted content (tool blocks with ANSI) — render lines as-is
        for (const cl of msg.content.split("\n")) {
          lines.push(`  ${cl}`);
        }
      } else {
        lines.push(`${DIM}  ${msg.content}${RESET}`);
      }
      lines.push("");
      idx++;
    }
    this.msgCacheLines = lines;
    this.msgCacheWidth = maxWidth;
    this.msgCacheLen = this.messages.length;
    return lines;
  }

  /** Contextual tool action label */
  private toolActionLabel(name: string, done: boolean): string {
    const labels: Record<string, [string, string]> = {
      readFile: ["Reading", "Read"],
      listFiles: ["Listing", "Listed"],
      grep: ["Searching", "Searched"],
      writeFile: ["Writing", "Wrote"],
      editFile: ["Editing", "Edited"],
      bash: ["Running", "Ran"],
    };
    const pair = labels[name];
    if (pair) return done ? pair[1] : pair[0];
    return done ? name : `${name}`;
  }

  /** Render a tool call block with diff/detail */
  private renderToolCallBlock(tc: typeof this.toolCallGroups[0], maxWidth: number): string[] {
    const lines: string[] = [];
    const done = !!tc.result;
    const icon = tc.error ? `${RED}\u25CF${RESET}` : done ? `${GREEN}\u25CF${RESET}` : `${DIM}\u25CF${RESET}`;
    const label = this.toolActionLabel(tc.name, done);
    const titleLabel = tc.name === "editFile" ? "Update" : tc.name === "writeFile" ? "Write" : tc.name === "bash" ? "Bash" : label;

    // Header line: ● Update(src/ai/stream.ts)
    lines.push(`${icon} ${WHITE}${titleLabel}(${tc.preview})${RESET}`);

    const a = tc.args as Record<string, string> | undefined;

    if (tc.name === "editFile" && a?.old_string && a?.new_string) {
      // Show diff with context
      const oldLines = a.old_string.split("\n");
      const newLines = a.new_string.split("\n");
      const addedCount = newLines.length;
      const removedCount = oldLines.length;
      lines.push(`${DIM}  \u2514 Added ${addedCount} line${addedCount !== 1 ? "s" : ""}, removed ${removedCount} line${removedCount !== 1 ? "s" : ""}${RESET}`);

      // Show removed lines (red bg), max 6 lines
      const maxDiffLines = 6;
      const diffW = maxWidth - 4;
      const showOld = oldLines.slice(0, maxDiffLines);
      for (const l of showOld) {
        const text = ` - ${l}`.slice(0, diffW);
        const pad = Math.max(0, diffW - text.length);
        lines.push(`${bg(80, 20, 20)} ${text}${" ".repeat(pad)} ${RESET}`);
      }
      if (oldLines.length > maxDiffLines) {
        lines.push(`${DIM}    ... +${oldLines.length - maxDiffLines} more removed${RESET}`);
      }
      // Show added lines (green bg), max 6 lines
      const showNew = newLines.slice(0, maxDiffLines);
      for (const l of showNew) {
        const text = ` + ${l}`.slice(0, diffW);
        const pad = Math.max(0, diffW - text.length);
        lines.push(`${bg(20, 60, 20)} ${text}${" ".repeat(pad)} ${RESET}`);
      }
      if (newLines.length > maxDiffLines) {
        lines.push(`${DIM}    ... +${newLines.length - maxDiffLines} more added${RESET}`);
      }
    } else if (tc.name === "writeFile" && a?.content) {
      const contentLines = a.content.split("\n");
      const diffW = maxWidth - 4;
      lines.push(`${DIM}  \u2514 ${contentLines.length} line${contentLines.length !== 1 ? "s" : ""}${RESET}`);
      const preview = contentLines.slice(0, 4);
      for (const l of preview) {
        const text = ` + ${l}`.slice(0, diffW);
        const pad = Math.max(0, diffW - text.length);
        lines.push(`${bg(20, 60, 20)} ${text}${" ".repeat(pad)} ${RESET}`);
      }
      if (contentLines.length > 4) {
        lines.push(`${DIM}    ... +${contentLines.length - 4} more lines${RESET}`);
      }
    } else if (tc.name === "bash") {
      if (tc.resultDetail) {
        const outLines = tc.resultDetail.split("\n").slice(0, 3);
        for (const l of outLines) {
          lines.push(`${DIM}  \u2514 ${l.slice(0, maxWidth - 6)}${RESET}`);
        }
      } else if (!done) {
        lines.push(`${DIM}  \u2514 running...${RESET}`);
      }
    } else if (tc.name === "readFile" || tc.name === "listFiles" || tc.name === "grep") {
      // Simple one-liner for read operations
      if (tc.resultDetail) {
        lines.push(`${DIM}  \u2514 ${tc.resultDetail.slice(0, maxWidth - 6)}${RESET}`);
      }
    }

    // Show error if any
    if (tc.error && tc.result) {
      lines.push(`${RED}  \u2514 ${tc.result}${RESET}`);
    }

    return lines;
  }

  /** Render messages + dynamic overlays (tool calls, thinking, loading) */
  private renderMessages(maxWidth: number): string[] {
    const lines = [...this.renderStaticMessages(maxWidth)];

    // In-progress tool calls during streaming
    if (this.isStreaming && this.toolCallGroups.length > 0) {
      for (const tc of this.toolCallGroups) {
        const block = this.renderToolCallBlock(tc, maxWidth);
        for (const l of block) lines.push(`  ${l}`);
        lines.push("");
      }
    }

    // Thinking block
    if (this.thinkingBuffer) {
      const thinkLines = this.thinkingBuffer.split("\n").slice(-3);
      lines.push(`${GRAY}  ${"─".repeat(Math.min(20, maxWidth - 6))}${RESET}`);
      lines.push(`${GRAY}  thinking${RESET}`);
      for (const tl of thinkLines) {
        lines.push(`${GRAY}  ${tl.slice(0, maxWidth - 4)}${RESET}`);
      }
      lines.push("");
    }

    // Compacting indicator
    if (this.isCompacting) {
      const spinnerFrames = ["\u00B7", "\u25E6", "\u25CB", "\u25C9", "\u25CB", "\u25E6"];
      const spinner = spinnerFrames[this.spinnerFrame % spinnerFrames.length];
      const elapsed = Date.now() - this.compactStartTime;
      const secs = Math.floor(elapsed / 1000);
      const mins = Math.floor(secs / 60);
      const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
      const tokenStr = this.compactTokens > 0 ? ` \u2191 ${fmtTokens(this.compactTokens)} tokens` : "";
      lines.push(`  ${YELLOW}${spinner}${RESET} ${YELLOW}Compacting conversation...${RESET} ${DIM}(${timeStr}${tokenStr ? ` \u00B7${tokenStr}` : ""})${RESET}`);
      lines.push("");
    }

    // Loading indicator — only show before model starts outputting text
    const lastMsg = this.messages[this.messages.length - 1];
    const hasOutput = lastMsg && lastMsg.role === "assistant" && lastMsg.content.length > 0;
    if (this.isStreaming && !this.thinkingBuffer && !hasOutput) {
      const loadingMessages = [
        "Thinking...", "Working on it...", "Processing...", "Generating...",
        "Cooking something up...", "Connecting the dots...", "Crunching...",
        "Putting it together...", "Brewing...", "Almost there...",
        "Hammering away...", "Just a moment...", "Spinning gears...", "On it...",
      ];
      const spinnerFrames = ["\u00B7", "\u25E6", "\u25CB", "\u25C9", "\u25CB", "\u25E6"];
      const spinner = spinnerFrames[this.spinnerFrame % spinnerFrames.length];
      const msgIdx = Math.floor(this.spinnerFrame / 20) % loadingMessages.length;
      const msg = loadingMessages[msgIdx];
      const elapsed = Date.now() - this.streamStartTime;
      const secs = Math.floor(elapsed / 1000);
      const mins = Math.floor(secs / 60);
      const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
      const tokenStr = this.streamTokens > 0 ? ` | ${fmtTokens(this.streamTokens)} tokens` : "";
      lines.push(`  ${T()}${spinner}${RESET} ${this.shimmerText(msg, this.spinnerFrame)}  ${DIM}(${timeStr}${tokenStr})${RESET}`);
      lines.push("");
    }
    return lines;
  }

  private renderCompactHeader(): string {
    const model = `${T()}${this.providerName}/${this.modelName}${RESET}`;
    const git = this.gitBranch ? ` ${DIM}${this.gitBranch}${this.gitDirty ? "*" : ""}${RESET}` : "";
    const activity = this.isStreaming ? `${bounceDot(this.spinnerFrame)} ` : "";
    return `${activity} ${model}${git}`;
  }

  /** Render the sidebar content */
  private renderSidebar(): string[] {
    const w = this.screen.sidebarWidth;
    const lines: string[] = [];
    const sideActivity = this.isStreaming ? ` ${bounceDot(this.spinnerFrame)}` : "";

    // Model
    lines.push(`${T()}${this.providerName}/${this.modelName}${RESET}${sideActivity}`);
    lines.push(`${DIM}${"─".repeat(Math.max(1, w - 2))}${RESET}`);
    lines.push("");

    // Providers
    if (this.detectedProviders.length > 0) {
      lines.push(`${DIM}providers${RESET}`);
      lines.push("");
      for (const p of this.detectedProviders.slice(0, 5)) {
        lines.push(`  ${p}`);
      }
      if (this.detectedProviders.length > 5) {
        lines.push(`  ${DIM}+${this.detectedProviders.length - 5} more${RESET}`);
      }
      lines.push("");
      lines.push(`${DIM}${"─".repeat(Math.max(1, w - 2))}${RESET}`);
      lines.push("");
    }

    // Working directory
    lines.push(`${DIM}directory${RESET}`);
    lines.push("");
    const shortCwd = this.cwd.length > w - 4
      ? "..." + this.cwd.slice(-(w - 7))
      : this.cwd;
    lines.push(`  ${DIM}${shortCwd}${RESET}`);
    if (this.gitBranch) {
      lines.push(`  ${DIM}${this.gitBranch}${this.gitDirty ? " *" : ""}${RESET}`);
    }

    // Fill remaining height
    const bottomLines = 4; // separator + buffer
    const remaining = this.screen.height - bottomLines - lines.length;
    for (let i = 0; i < remaining; i++) lines.push("");

    // Bottom
    lines.push(`${DIM}${"─".repeat(Math.max(1, w - 2))}${RESET}`);
    lines.push(`${DIM}/help  /model  /settings${RESET}`);

    return lines;
  }

  /** Pad or truncate a visible string to a target width */
  private padLine(line: string, targetWidth: number): string {
    const visible = stripAnsi(line).length;
    if (visible >= targetWidth) return line;
    return line + " ".repeat(targetWidth - visible);
  }

  /** Throttled draw — coalesces rapid calls to ~60fps */
  private draw(): void {
    if (this.drawScheduled) return;
    const now = Date.now();
    const elapsed = now - this.lastDrawTime;
    if (elapsed >= App.DRAW_THROTTLE_MS) {
      this.drawImmediate();
    } else {
      this.drawScheduled = true;
      setTimeout(() => {
        this.drawScheduled = false;
        this.drawImmediate();
      }, App.DRAW_THROTTLE_MS - elapsed);
    }
  }

  private drawImmediate(): void {
    this.lastDrawTime = Date.now();
    const { height, width } = this.screen;
    const hasSidebar = this.screen.hasSidebar && this.messages.length > 0;
    const mainW = hasSidebar ? this.screen.mainWidth : width;
    const inputText = this.input.getText();
    const cursor = this.input.getCursor();
    const isHome = this.messages.length === 0;

    // Build bottom section first to know how much space it takes
    const bottomLines: string[] = [];

    // Separator above input
    bottomLines.push(`${DIM}${"─".repeat(mainW)}${RESET}`);

    // Input line(s) — support multi-line via shift+enter
    if (inputText && inputText.includes("\n")) {
      const inputLines = inputText.split("\n");
      bottomLines.push(`${T()} > ${RESET}${inputLines[0]}`);
      for (let i = 1; i < inputLines.length; i++) {
        bottomLines.push(`${T()}   ${RESET}${inputLines[i]}`);
      }
    } else {
      bottomLines.push(`${T()} > ${RESET}${inputText}`);
    }

    // Suggestions/picker appear BELOW input (like Pi)
    if (this.filePicker) {
      this.appendFilePicker(bottomLines, height);
    } else if (this.itemPicker) {
      this.appendItemPicker(bottomLines, height);
    } else if (this.settingsPicker) {
      this.appendSettingsPicker(bottomLines, height);
    } else if (this.modelPicker) {
      this.appendModelPicker(bottomLines, height);
    } else {
      const suggestions = this.getCommandSuggestions();
      for (const s of suggestions) bottomLines.push(s);
    }

    // Separator below input/pickers
    bottomLines.push(`${DIM}${"─".repeat(mainW)}${RESET}`);

    // Info bar below input — contextual status + hints
    {
      const parts: Array<{ text: string; plain: string; priority: number }> = [];
      const modeColor = this.mode === "plan" ? P() : T();
      const modeLabel = this.mode === "plan" ? "plan" : "build";
      if (this.isStreaming) {
        parts.push({ text: `${DIM}esc${RESET} ${DIM}interrupt${RESET}`, plain: "esc interrupt", priority: 0 });
      }
      parts.push({ text: `${modeColor}${modeLabel}${RESET} ${DIM}(shift+tab)${RESET}`, plain: `${modeLabel} (shift+tab)`, priority: 1 });
      if (this.pendingMessages.length > 0) {
        parts.push({ text: `${P()}${this.pendingMessages.length} queued${RESET}`, plain: `${this.pendingMessages.length} queued`, priority: 2 });
      }
      const settings = getSettings();
      if (settings.enableThinking) {
        parts.push({ text: `${DIM}thinking${RESET}`, plain: "thinking", priority: 3 });
      }
      // Cost/tokens/context in bottom bar
      const liveTokens = this.isStreaming ? this.sessionTokens + this.streamTokens : this.sessionTokens;
      if (this.sessionCost > 0 || liveTokens > 0) {
        const costStr = fmtCost(this.sessionCost);
        const tokStr = fmtTokens(liveTokens);
        parts.push({ text: `${DIM}${costStr} ${tokStr} tok${RESET}`, plain: `${costStr} ${tokStr} tok`, priority: 4 });
      }
      if (this.contextUsed > 0) {
        const ctxColor = this.contextUsed > 90 ? RED : this.contextUsed > 70 ? "\x1b[33m" : DIM;
        parts.push({ text: `${ctxColor}${this.contextUsed}% ctx${RESET}`, plain: `${this.contextUsed}% ctx`, priority: 5 });
      }
      // Collapse from lowest priority until it fits
      const sep = " | ";
      let visible = [...parts];
      while (visible.length > 1) {
        const totalWidth = visible.reduce((s, p) => s + p.plain.length, 0) + (visible.length - 1) * sep.length + 2;
        if (totalWidth <= mainW) break;
        visible.pop();
      }
      bottomLines.push(` ${visible.map(p => p.text).join(`${DIM}${sep}${RESET}`)}`);
    }

    // Status bar — only show if there's a status message (errors, warnings)
    if (this.statusMessage) {
      bottomLines.push(` ${this.statusMessage}`);
    }

    // Now build the top section (chat area fills remaining space)
    const frameLines: string[] = [];
    const topHeight = height - bottomLines.length;

    // Always show compact header at top (model info)
    const showCompactHeader = !hasSidebar && this.modelName !== "none";
    if (showCompactHeader) {
      frameLines.push(this.renderCompactHeader());
    }

    if (isHome) {
      frameLines.push("");
      frameLines.push(`${T()}${BOLD}  BrokeCLI${RESET}`);
      frameLines.push(`${DIM}  AI coding on a budget${RESET}`);
      frameLines.push("");
      const used = frameLines.length;
      for (let i = used; i < topHeight; i++) frameLines.push("");
    } else {
      if (false) { // compact header already rendered above
        frameLines.push(this.renderCompactHeader());
      }

      const chatH = topHeight - (showCompactHeader ? 1 : 0);
      const messageLines = this.renderMessages(mainW);
      // Clamp scroll offset to prevent overflow
      const maxScroll = Math.max(0, messageLines.length - chatH);
      if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;
      if (this.scrollOffset < 0) this.scrollOffset = 0;
      const visible = messageLines.slice(this.scrollOffset, this.scrollOffset + chatH);

      if (hasSidebar) {
        const sidebarLines = this.renderSidebar();
        const border = `${DIM}│${RESET}`;
        for (let i = 0; i < chatH; i++) {
          const chatLine = this.padLine(visible[i] ?? "", mainW);
          const sidebarLine = sidebarLines[i] ?? "";
          const paddedSidebar = this.padLine(sidebarLine, this.screen.sidebarWidth);
          frameLines.push(`${chatLine} ${border} ${paddedSidebar}`);
        }
      } else {
        for (let i = 0; i < chatH; i++) {
          frameLines.push(visible[i] ?? "");
        }
      }
    }

    // Combine top + bottom
    for (const l of bottomLines) frameLines.push(l);

    this.screen.render(frameLines);

    // Cursor on input line — account for multi-line input
    const textBeforeCursor = inputText.slice(0, cursor);
    const cursorLineIdx = (textBeforeCursor.match(/\n/g) || []).length;
    const lastNewline = textBeforeCursor.lastIndexOf("\n");
    const colInLine = lastNewline >= 0 ? cursor - lastNewline - 1 : cursor;
    const inputRow = topHeight + 2 + cursorLineIdx; // +1 separator, +1 for 1-based
    const inputCol = (cursorLineIdx === 0 ? 4 : 4) + colInLine;
    this.screen.setCursor(inputRow, inputCol);
  }

/** Shimmer effect — green wave sweeping across text */
  private shimmerText(text: string, frame: number): string {
    const period = text.length + 8;
    const pos = (frame * 0.6) % period;
    let result = "";
    for (let i = 0; i < text.length; i++) {
      const dist = Math.abs(i - pos);
      const t = Math.max(0, 1 - dist / 4);
      // Shimmer from dim green (30,100,30) to bright green (58,220,58)
      const r = Math.round(30 + t * 28);
      const g = Math.round(100 + t * 120);
      const b = Math.round(30 + t * 28);
      result += `\x1b[38;2;${r};${g};${b}m${text[i]}`;
    }
    return result + RESET;
  }

  private appendModelPicker(lines: string[], _maxTotal: number): void {
    const picker = this.modelPicker!;
    lines.push(` ${T()}${BOLD}Select model${RESET}${picker.query ? `  ${DIM}/${RESET}${picker.query}` : ""}`);

    const filtered = this.getFilteredModels();
    if (filtered.length === 0) {
      lines.push(`  ${DIM}no matches${RESET}`);
      lines.push("");
      lines.push(` ${DIM}type to search, esc to close${RESET}`);
      return;
    }

    // Group filtered options by provider
    const byProvider = new Map<string, ModelOption[]>();
    for (const opt of filtered) {
      if (!byProvider.has(opt.providerName)) byProvider.set(opt.providerName, []);
      byProvider.get(opt.providerName)!.push(opt);
    }

    // Flat list with headers
    let currentIdx = 0;
    const flatList: Array<{ type: 'header' | 'model'; provider: string; option?: ModelOption; index: number }> = [];
    for (const [provider, opts] of byProvider) {
      flatList.push({ type: 'header', provider, index: -1 });
      for (const opt of opts) {
        flatList.push({ type: 'model', provider, option: opt, index: currentIdx++ });
      }
    }

    const cursorFlatIdx = flatList.findIndex(item => item.index === picker.cursor);
    const maxVisible = 12;
    let start = Math.max(0, cursorFlatIdx - Math.floor(maxVisible / 2));
    if (start + maxVisible > flatList.length) start = Math.max(0, flatList.length - maxVisible);
    const end = Math.min(start + maxVisible, flatList.length);

    for (let i = start; i < end; i++) {
      const item = flatList[i];
      if (item.type === 'header') {
        lines.push(` ${DIM}${item.provider}${RESET}`);
      } else {
        const opt = item.option!;
        const isCursor = item.index === picker.cursor;
        const pin = opt.active ? ` ${T()}*${RESET}` : "";
        const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
        const nameCol = isCursor ? `${WHITE}${BOLD}` : T();
        lines.push(`  ${arrow}${nameCol}${opt.modelId}${RESET}${pin}`);
      }
    }
    lines.push(` ${DIM}(${Math.min(picker.cursor + 1, filtered.length)}/${filtered.length}) tab pin, enter select${RESET}`);
  }

  private appendFilePicker(lines: string[], maxTotal: number): void {
    const picker = this.filePicker!;
    const maxItems = Math.min(picker.filtered.length, maxTotal - 4);
    for (let i = 0; i < maxItems; i++) {
      const f = picker.filtered[i];
      const isCursor = i === picker.cursor;
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const color = isCursor ? `${WHITE}${BOLD}` : DIM;
      lines.push(` ${arrow}${color}${f}${RESET}`);
    }
    if (picker.filtered.length === 0) {
      lines.push(` ${DIM}  no matches${RESET}`);
    }
    lines.push(` ${DIM}(${picker.filtered.length} files)${RESET}`);
  }

  private appendSettingsPicker(lines: string[], _maxTotal: number): void {
    const picker = this.settingsPicker!;
    lines.push(` ${T()}${BOLD}Settings${RESET}${picker.query ? `  ${DIM}/${RESET}${picker.query}` : ""}`);

    const filtered = this.getFilteredSettings();
    if (filtered.length === 0) {
      lines.push(`  ${DIM}no matches${RESET}`);
      return;
    }

    const maxVisible = 6;
    let start = Math.max(0, picker.cursor - Math.floor(maxVisible / 2));
    if (start + maxVisible > filtered.length) start = Math.max(0, filtered.length - maxVisible);
    const end = Math.min(start + maxVisible, filtered.length);

    for (let i = start; i < end; i++) {
      const e = filtered[i];
      const isCursor = i === picker.cursor;
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const nameCol = isCursor ? `${WHITE}${BOLD}` : T();
      const pad = " ".repeat(Math.max(1, 22 - e.label.length));
      const valColor = e.value === "true" ? T() : DIM;
      lines.push(` ${arrow}${nameCol}${e.label}${RESET}${pad}${valColor}${e.value}${RESET}`);
    }

    const selected = filtered[picker.cursor];
    if (selected) {
      lines.push(` ${DIM}${selected.description}${RESET}`);
    }
  }

  private appendItemPicker(lines: string[], _maxTotal: number): void {
    const picker = this.itemPicker!;
    lines.push(` ${T()}${BOLD}${picker.title}${RESET}${picker.query ? `  ${DIM}/${RESET}${picker.query}` : ""}`);

    const filtered = this.getFilteredItems();
    if (filtered.length === 0) {
      lines.push(`  ${DIM}no matches${RESET}`);
      return;
    }

    const maxVisible = 10;
    let start = Math.max(0, picker.cursor - Math.floor(maxVisible / 2));
    if (start + maxVisible > filtered.length) start = Math.max(0, filtered.length - maxVisible);
    const end = Math.min(start + maxVisible, filtered.length);

    for (let i = start; i < end; i++) {
      const item = filtered[i];
      const isCursor = i === picker.cursor;
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const labelCol = isCursor ? `${WHITE}${BOLD}` : T();
      lines.push(` ${arrow}${labelCol}${item.label}${RESET}${item.detail ? ` ${DIM}${item.detail}${RESET}` : ""}`);
    }
    lines.push(` ${DIM}(${Math.min(picker.cursor + 1, filtered.length)}/${filtered.length}) enter to select${RESET}`);
  }

  private getCommandMatches(): typeof COMMANDS {
    const text = this.input.getText();
    if (!text.startsWith("/")) return [];
    const query = text.slice(1).toLowerCase();
    if (!query && text === "/") return [...COMMANDS];
    return COMMANDS.filter((c) => c.name.startsWith(query) && c.name !== query);
  }

  private getCommandSuggestions(): string[] {
    const matches = this.getCommandMatches();
    if (matches.length === 0) return [];

    const cursor = Math.min(this.cmdSuggestionCursor, matches.length - 1);
    const maxVisible = 5;
    // Scroll window around cursor
    let start = Math.max(0, cursor - Math.floor(maxVisible / 2));
    if (start + maxVisible > matches.length) start = Math.max(0, matches.length - maxVisible);
    const end = Math.min(start + maxVisible, matches.length);

    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      const c = matches[i];
      const arrow = i === cursor ? `${T()}> ${RESET}` : "  ";
      const nameColor = i === cursor ? `${WHITE}${BOLD}` : T();
      const pad = " ".repeat(Math.max(1, 16 - c.name.length));
      lines.push(` ${arrow}${nameColor}${c.name}${RESET}${pad}${DIM}${c.desc}${RESET}`);
    }
    lines.push(` ${DIM}(${cursor + 1}/${matches.length})${RESET}`);
    return lines;
  }

  onInput(handler: (text: string, images?: Array<{ mimeType: string; data: string }>) => void): void {
    this.onSubmit = handler as (text: string) => void;
  }

  onPendingMessagesReadyHandler(handler: () => void): void {
    this.onPendingMessagesReady = handler;
  }

  /** Get pending images and clear them */
  takePendingImages(): Array<{ mimeType: string; data: string }> {
    const images = this.pendingImages;
    this.pendingImages = [];
    return images;
  }

  /** Add a message to the pending queue */
  addPendingMessage(text: string, images?: Array<{ mimeType: string; data: string }>): void {
    this.pendingMessages.push({ text, images });
    this.draw();
  }

  /** Get and clear pending messages */
  takePendingMessages(): Array<{ text: string; images?: Array<{ mimeType: string; data: string }> }> {
    const messages = this.pendingMessages;
    this.pendingMessages = [];
    return messages;
  }

  /** Check if there are pending messages */
  hasPendingMessages(): boolean {
    return this.pendingMessages.length > 0;
  }

  /** Get count of pending messages */
  getPendingMessagesCount(): number {
    return this.pendingMessages.length;
  }

  /** Trigger processing of pending messages */
  flushPendingMessages(): void {
    if (this.onPendingMessagesReady) {
      this.onPendingMessagesReady();
    }
  }

  onAbortRequest(handler: () => void): void {
    this.onAbort = handler;
  }

  onScopedModelCycle(handler: () => void): void {
    this.onCycleScopedModel = handler;
  }

  start(): void {
    this.running = true;

    // Detect git branch and dirty state
    try {
      this.gitBranch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 3000 }).trim();
    } catch { /* not a git repo */ }
    try {
      const status = execSync("git status --porcelain", { encoding: "utf-8", timeout: 3000 }).trim();
      this.gitDirty = status.length > 0;
    } catch { /* not a git repo */ }

    this.screen.enter();
    this.keypress.start();
    this.draw();

    process.stdout.on("resize", () => {
      this.screen.forceRedraw([]);
      this.draw();
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.keypress.stop();
    this.screen.exit();

    console.log("");
    console.log(`${T()}${BOLD} BrokeCLI${RESET} ${DIM}session ended${RESET}`);
    console.log(`${DIM} ${fmtCost(this.sessionCost)} | ${fmtTokens(this.sessionTokens)} tokens${RESET}`);
    console.log("");
    process.exit(0);
  }
}
