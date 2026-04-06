import { Screen } from "./screen.js";
import { KeypressHandler, type Keypress } from "./keypress.js";
import { InputWidget } from "./input.js";
import { GRAY, RESET, BOLD, DIM, RED, WHITE, GREEN, bg, moveTo } from "../utils/ansi.js";
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

const COMMANDS = [
  { name: "model", desc: "switch model" },
  { name: "settings", desc: "configure options" },
  { name: "theme", desc: "switch theme" },
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
  private modelPicker: { options: ModelOption[]; cursor: number } | null = null;
  private onModelSelect: ((providerId: string, modelId: string) => void) | null = null;
  private onModelPin: ((providerId: string, modelId: string, pinned: boolean) => void) | null = null;
  private settingsPicker: { entries: SettingEntry[]; cursor: number } | null = null;
  private onSettingToggle: ((key: string) => void) | null = null;
  private filePicker: { files: string[]; filtered: string[]; query: string; cursor: number } | null = null;
  private projectFiles: string[] | null = null;
  private fileContexts: Map<string, string> = new Map();
  private cmdSuggestionCursor = 0;
  private itemPicker: { title: string; items: PickerItem[]; cursor: number } | null = null;
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

  constructor() {
    this.screen = new Screen();
    this.input = new InputWidget();
    this.keypress = new KeypressHandler(
      (key) => this.handleKey(key),
      (text) => this.handlePaste(text),
    );
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
    }
    if (streaming) {
      this.spinnerFrame = 0;
      this.spinnerTimer = setInterval(() => {
        this.spinnerFrame++;
        this.draw();
      }, 150);
    } else if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    this.draw();
  }

  setDetectedProviders(providers: string[]): void {
    this.detectedProviders = providers;
  }

  openModelPicker(options: ModelOption[], onSelect: (providerId: string, modelId: string) => void, onPin?: (providerId: string, modelId: string, pinned: boolean) => void, initialCursor?: number): void {
    const cursorIdx = initialCursor ?? options.findIndex((o) => o.active);
    this.modelPicker = { options, cursor: cursorIdx >= 0 ? cursorIdx : 0 };
    this.onModelSelect = onSelect;
    this.onModelPin = onPin ?? null;
    this.draw();
  }

  openSettings(entries: SettingEntry[], onToggle: (key: string) => void): void {
    this.settingsPicker = { entries, cursor: 0 };
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
    this.itemPicker = { title, items, cursor: 0 };
    this.onItemSelect = onSelect;
    this.draw();
  }

  clearMessages(): void {
    this.messages = [];
    this.scrollOffset = 0;
    this.screen.forceRedraw([]);
    this.draw();
  }

  addMessage(role: "user" | "assistant" | "system", content: string, images?: Array<{ mimeType: string; data: string }>): void {
    this.messages.push({ role, content, images });
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
    this.scrollToBottom();
    this.draw();
  }

  appendThinking(delta: string): void {
    this.thinkingBuffer += delta;
    this.scrollToBottom();
    this.draw();
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
    return this.screen.height - 2 - headerLines; // status(1) + input(1) + optional header
  }

  private handleKey(key: Keypress): void {
    // Settings picker
    if (this.settingsPicker) {
      if (key.name === "up") {
        this.settingsPicker.cursor = Math.max(0, this.settingsPicker.cursor - 1);
        this.draw();
      } else if (key.name === "down") {
        this.settingsPicker.cursor = Math.min(this.settingsPicker.entries.length - 1, this.settingsPicker.cursor + 1);
        this.draw();
      } else if (key.name === "return" || key.name === "space") {
        const entry = this.settingsPicker.entries[this.settingsPicker.cursor];
        if (entry && this.onSettingToggle) this.onSettingToggle(entry.key);
        this.draw();
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.settingsPicker = null;
        this.draw();
      }
      return;
    }

    // Item picker (sessions, themes, etc.)
    if (this.itemPicker) {
      if (key.name === "up") {
        this.itemPicker.cursor = Math.max(0, this.itemPicker.cursor - 1);
        this.draw();
      } else if (key.name === "down") {
        this.itemPicker.cursor = Math.min(this.itemPicker.items.length - 1, this.itemPicker.cursor + 1);
        this.draw();
      } else if (key.name === "return") {
        const item = this.itemPicker.items[this.itemPicker.cursor];
        if (item && this.onItemSelect) {
          this.onItemSelect(item.id);
        }
        this.itemPicker = null;
        this.draw();
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.itemPicker = null;
        this.draw();
      }
      return;
    }

    // Model picker intercepts all keys when open
    if (this.modelPicker) {
      if (key.name === "up") {
        this.modelPicker.cursor = Math.max(0, this.modelPicker.cursor - 1);
        this.draw();
      } else if (key.name === "down") {
        this.modelPicker.cursor = Math.min(this.modelPicker.options.length - 1, this.modelPicker.cursor + 1);
        this.draw();
      } else if (key.name === "space") {
        const opt = this.modelPicker.options[this.modelPicker.cursor];
        if (opt) {
          opt.active = !opt.active;
          if (this.onModelPin) this.onModelPin(opt.providerId, opt.modelId, opt.active);
          // Re-sort: starred models go to top
          this.modelPicker.options.sort((a, b) => {
            if (a.active && !b.active) return -1;
            if (!a.active && b.active) return 1;
            return 0;
          });
          // Keep cursor on the same item
          this.modelPicker.cursor = this.modelPicker.options.indexOf(opt);
        }
        this.draw();
      } else if (key.name === "return") {
        const selected = this.modelPicker.options[this.modelPicker.cursor];
        this.modelPicker = null;
        if (selected && this.onModelSelect) {
          this.onModelSelect(selected.providerId, selected.modelId);
        }
        this.draw();
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.modelPicker = null;
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

    // Tab — toggle between build and plan mode (when input is empty)
    if (key.name === "tab" && this.input.getText().trim() === "") {
      this.mode = this.mode === "build" ? "plan" : "build";
      if (this.onModeChange) this.onModeChange(this.mode);
      this.draw();
      return;
    }

    if (key.name === "pageup") { this.scrollOffset = Math.max(0, this.scrollOffset - 5); this.draw(); return; }
    if (key.name === "pagedown") { this.scrollToBottom(); this.draw(); return; }

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

  /** Render messages as terminal lines */
  private renderMessages(maxWidth: number): string[] {
    const lines: string[] = [];
    let idx = 0;
    while (idx < this.messages.length) {
      const msg = this.messages[idx];
      if (msg.role === "user") {
        // Build inline image tags with green background
        let content = msg.content;
        if (msg.images && msg.images.length > 0) {
          for (let i = 0; i < msg.images.length; i++) {
            const tag = `${bg(58, 199, 58)}${BOLD}${WHITE}[IMAGE ${i + 1}]${RESET}`;
            content += ` ${tag}`;
          }
        }
        lines.push(`${BOLD}${WHITE}  > ${content}${RESET}`);
      } else if (msg.role === "assistant") {
        // Always render markdown - even during streaming
        const rendered = renderMarkdown(msg.content);
        for (const cl of rendered.split("\n")) {
          const visLen = stripAnsi(cl).length;
          if (visLen <= maxWidth - 4) {
            lines.push(`    ${cl}`);
          } else {
            // Simple wrap — just push the line as-is for now (ANSI-aware wrapping is complex)
            lines.push(`    ${cl}`);
          }
        }
      } else if (this.toolOutputCollapsed && this.isToolOutput(msg.content)) {
        // Skip consecutive tool output system messages
        while (idx + 1 < this.messages.length
          && this.messages[idx + 1].role === "system"
          && this.isToolOutput(this.messages[idx + 1].content)) {
          idx++;
        }
        lines.push(`${DIM}  [tool output hidden]${RESET}`);
      } else {
        lines.push(`${DIM}  ${msg.content}${RESET}`);
      }
      lines.push("");
      idx++;
    }
    // Thinking block (shown during streaming if model sends reasoning)
    if (this.thinkingBuffer) {
      const thinkLines = this.thinkingBuffer.split("\n").slice(-3); // show last 3 lines
      lines.push(`${DIM}  thinking...${RESET}`);
      for (const tl of thinkLines) {
        lines.push(`${DIM}  ${tl.slice(0, maxWidth - 4)}${RESET}`);
      }
      lines.push("");
    }
    if (this.isStreaming && !this.thinkingBuffer) {
      const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
      const frame = frames[this.spinnerFrame % frames.length];
      lines.push(`${T()}  ${frame} ${RESET}${DIM}Working...${RESET}`);
      lines.push("");
    }
    return lines;
  }

  private renderCompactHeader(): string {
    const modeColor = this.mode === "plan" ? P() : T();
    const modeLabel = this.mode === "plan" ? "PLAN" : "BUILD";
    const model = `${T()}${this.providerName}/${this.modelName}${RESET}`;
    const cost = `$${this.sessionCost.toFixed(4)}`;
    const tokens = `${this.sessionTokens} tok`;
    const ctxColor = this.contextUsed > 90 ? RED : this.contextUsed > 70 ? "\x1b[33m" : DIM;
    const ctx = this.contextUsed > 0 ? ` ${ctxColor}${this.contextUsed}%${RESET}` : "";
    const streaming = this.isStreaming ? ` ${modeColor}working${RESET}` : "";
    const git = this.gitBranch ? ` ${DIM}${this.gitBranch}${this.gitDirty ? "*" : ""}${RESET}` : "";
    return ` ${modeColor}[${modeLabel}]${RESET} ${model} ${DIM}│${RESET} ${cost} ${tokens}${ctx}${streaming}${git}`;
  }

  /** Render the sidebar content */
  private renderSidebar(): string[] {
    const w = this.screen.sidebarWidth;
    const lines: string[] = [];

    // Mode indicator with separator
    const modeColor = this.mode === "plan" ? P() : T();
    const modeLabel = this.mode === "plan" ? "PLAN" : "BUILD";
    lines.push(`${modeColor}▌ ${modeLabel}${RESET}`);
    lines.push(`${DIM}${"─".repeat(Math.max(1, w - 2))}${RESET}`);

    // Model
    lines.push(`${T()}${this.providerName}/${this.modelName}${RESET}`);
    lines.push("");

    // Stats with subtle separator
    lines.push(`${DIM}─${RESET} ${T()}$${this.sessionCost.toFixed(4)}${RESET} ${DIM}${this.sessionTokens} tok${RESET}`);
    if (this.contextUsed > 0) {
      const color = this.contextUsed > 90 ? RED : this.contextUsed > 70 ? "\x1b[33m" : DIM;
      lines.push(`   ${color}${this.contextUsed}% ctx${RESET}`);
    }
    // Pending messages indicator
    if (this.pendingMessages.length > 0) {
      const pendingCount = this.pendingMessages.length;
      lines.push(`   ${P()}${pendingCount} queued${RESET}`);
    }
    lines.push("");

    // Providers (if detected)
    if (this.detectedProviders.length > 0) {
      lines.push(`${DIM}─${RESET} ${DIM}providers${RESET}`);
      for (const p of this.detectedProviders.slice(0, 5)) {
        lines.push(`   ${p}`);
      }
      if (this.detectedProviders.length > 5) {
        lines.push(`   ${DIM}+${this.detectedProviders.length - 5} more${RESET}`);
      }
      lines.push("");
    }

    // Working directory with separator
    lines.push(`${DIM}─${RESET}`);
    const shortCwd = this.cwd.length > w - 4
      ? "..." + this.cwd.slice(-(w - 7))
      : this.cwd;
    lines.push(` ${DIM}${shortCwd}${RESET}`);

    // Git branch
    if (this.gitBranch) {
      lines.push(` ${DIM}${this.gitBranch}${this.gitDirty ? " *" : ""}${RESET}`);
    }

    // Fill remaining height
    const remaining = this.screen.height - 2 - lines.length;
    for (let i = 0; i < remaining; i++) lines.push("");

    // Bottom
    lines.push(`${DIM}─${RESET} ${DIM}/help${RESET}`);

    return lines;
  }

  /** Pad or truncate a visible string to a target width */
  private padLine(line: string, targetWidth: number): string {
    const visible = stripAnsi(line).length;
    if (visible >= targetWidth) return line;
    return line + " ".repeat(targetWidth - visible);
  }

  private draw(): void {
    const { height, width } = this.screen;
    const hasSidebar = this.screen.hasSidebar && this.messages.length > 0;
    const mainW = hasSidebar ? this.screen.mainWidth : width;
    const inputText = this.input.getText();
    const cursor = this.input.getCursor();
    const isHome = this.messages.length === 0;

    // Build bottom section first to know how much space it takes
    const bottomLines: string[] = [];

    // Input line
    if (inputText) {
      bottomLines.push(`${T()} > ${RESET}${inputText}`);
    } else {
      bottomLines.push(`${T()} > ${RESET}`);
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

    // Cursor on input line
    const inputRow = topHeight + 1; // +1 because input is first line of bottomLines
    const inputCol = 4 + cursor;
    this.screen.setCursor(inputRow, inputCol);
  }

private appendModelPicker(lines: string[], _maxTotal: number): void {
    const picker = this.modelPicker!;
    lines.push(` ${T()}${BOLD}Select model${RESET}`);
    lines.push("");

    // Group options by provider
    const byProvider = new Map<string, ModelOption[]>();
    for (const opt of picker.options) {
      if (!byProvider.has(opt.providerName)) {
        byProvider.set(opt.providerName, []);
      }
      byProvider.get(opt.providerName)!.push(opt);
    }

    // Build flat list with headers
    let currentIdx = 0;
    const flatList: Array<{ type: 'header' | 'model'; provider: string; option?: ModelOption; index: number }> = [];
    
    for (const [provider, opts] of byProvider) {
      flatList.push({ type: 'header', provider, index: -1 });
      for (const opt of opts) {
        flatList.push({ type: 'model', provider, option: opt, index: currentIdx++ });
      }
    }

    // Find cursor position in flat list
    const cursorFlatIdx = flatList.findIndex(item => item.index === picker.cursor);
    const maxVisible = 12;
    let start = Math.max(0, cursorFlatIdx - Math.floor(maxVisible / 2));
    if (start + maxVisible > flatList.length) start = Math.max(0, flatList.length - maxVisible);
    const end = Math.min(start + maxVisible, flatList.length);

    for (let i = start; i < end; i++) {
      const item = flatList[i];
      if (item.type === 'header') {
        lines.push(` ${T()}${BOLD}${item.provider}${RESET}`);
      } else {
        const opt = item.option!;
        const isCursor = item.index === picker.cursor;
        const isActive = opt.active;
        const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
        const check = isActive ? ` ${T()}*${RESET}` : "";
        const nameCol = isCursor ? `${WHITE}${BOLD}` : T();
        lines.push(`  ${arrow}${nameCol}${opt.modelId}${RESET}${check}`);
      }
    }
    lines.push("");
    lines.push(` ${DIM}(${picker.cursor + 1}/${picker.options.length}) space to pin, enter to select${RESET}`);
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
    const maxVisible = 5;
    let start = Math.max(0, picker.cursor - Math.floor(maxVisible / 2));
    if (start + maxVisible > picker.entries.length) start = Math.max(0, picker.entries.length - maxVisible);
    const end = Math.min(start + maxVisible, picker.entries.length);

    for (let i = start; i < end; i++) {
      const e = picker.entries[i];
      const isCursor = i === picker.cursor;
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const nameCol = isCursor ? `${WHITE}${BOLD}` : T();
      const pad = " ".repeat(Math.max(1, 22 - e.label.length));
      const valColor = e.value === "true" ? T() : DIM;
      lines.push(` ${arrow}${nameCol}${e.label}${RESET}${pad}${valColor}${e.value}${RESET}`);
    }
    lines.push(` ${DIM}(${picker.cursor + 1}/${picker.entries.length})${RESET}`);

    const selected = picker.entries[picker.cursor];
    if (selected) {
      lines.push("");
      lines.push(` ${DIM}${selected.description}${RESET}`);
      lines.push(` ${DIM}Enter/Space to change${RESET}`);
    }
  }

  private appendItemPicker(lines: string[], _maxTotal: number): void {
    const picker = this.itemPicker!;
    lines.push(` ${T()}${BOLD}${picker.title}${RESET}`);
    lines.push("");

    const maxVisible = 10;
    let start = Math.max(0, picker.cursor - Math.floor(maxVisible / 2));
    if (start + maxVisible > picker.items.length) start = Math.max(0, picker.items.length - maxVisible);
    const end = Math.min(start + maxVisible, picker.items.length);

    for (let i = start; i < end; i++) {
      const item = picker.items[i];
      const isCursor = i === picker.cursor;
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const labelCol = isCursor ? `${WHITE}${BOLD}` : T();
      lines.push(` ${arrow}${labelCol}${item.label}${RESET}${item.detail ? ` ${DIM}${item.detail}${RESET}` : ""}`);
    }
    lines.push("");
    lines.push(` ${DIM}(${picker.cursor + 1}/${picker.items.length}) Enter to select${RESET}`);
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
    console.log(`${DIM} $${this.sessionCost.toFixed(4)} | ${this.sessionTokens} tokens${RESET}`);
    console.log("");
    process.exit(0);
  }
}
