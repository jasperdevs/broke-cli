import { Screen } from "./screen.js";
import { KeypressHandler, type Keypress } from "./keypress.js";
import { InputWidget } from "./input.js";
import { GRAY, RESET, BOLD, DIM, RED, WHITE, GREEN, GREEN_DIM, YELLOW, bg, moveTo } from "../utils/ansi.js";
import { currentTheme, getPlanColor } from "../core/themes.js";
import { execSync } from "child_process";
import { matchesBinding, loadKeybindings } from "../core/keybindings.js";
import { getSettings, updateSetting } from "../core/config.js";
import type { Mode, ThinkingLevel, CavemanLevel } from "../core/config.js";
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

/** Animated counter — eases toward target value each tick */
class AnimCounter {
  target = 0;
  display = 0;
  tick(): void {
    if (this.display === this.target) return;
    const diff = this.target - this.display;
    // Move 25% of the way, min step 1 (for ints) or 0.0001 (for floats)
    const isFloat = this.target !== Math.floor(this.target);
    const minStep = isFloat ? Math.max(0.0001, Math.abs(diff) * 0.01) : 1;
    const step = Math.max(minStep, Math.abs(diff) * 0.25);
    if (Math.abs(diff) <= minStep) {
      this.display = this.target;
    } else {
      this.display += diff > 0 ? step : -step;
      if (!isFloat) this.display = Math.round(this.display);
    }
  }
  set(val: number): void { this.target = val; }
  reset(): void { this.target = 0; this.display = 0; }
  get(): number { return this.display; }
  getInt(): number { return Math.round(this.display); }
}

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

/** Intra-line diff: highlight changed words between two lines */
function intraLineDiff(oldLine: string, newLine: string, maxW: number): { oldHighlighted: string; newHighlighted: string } {
  // Simple word-level diff: split by word boundaries, find common prefix/suffix
  const INVERSE = "\x1b[7m";
  const NO_INVERSE = "\x1b[27m";

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldLine.length, newLine.length);
  while (prefixLen < minLen && oldLine[prefixLen] === newLine[prefixLen]) prefixLen++;

  // Find common suffix (from the end, not overlapping prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLine[oldLine.length - 1 - suffixLen] === newLine[newLine.length - 1 - suffixLen]
  ) suffixLen++;

  const oldPrefix = oldLine.slice(0, prefixLen);
  const oldChanged = oldLine.slice(prefixLen, oldLine.length - suffixLen);
  const oldSuffix = oldLine.slice(oldLine.length - suffixLen);

  const newPrefix = newLine.slice(0, prefixLen);
  const newChanged = newLine.slice(prefixLen, newLine.length - suffixLen);
  const newSuffix = newLine.slice(newLine.length - suffixLen);

  const oldHighlighted = oldChanged
    ? `${oldPrefix}${INVERSE}${oldChanged}${NO_INVERSE}${oldSuffix}`.slice(0, maxW)
    : oldLine.slice(0, maxW);
  const newHighlighted = newChanged
    ? `${newPrefix}${INVERSE}${newChanged}${NO_INVERSE}${newSuffix}`.slice(0, maxW)
    : newLine.slice(0, maxW);

  return { oldHighlighted, newHighlighted };
}

/** Word-aware text wrapping — never breaks mid-word if possible */
function wordWrap(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const words = text.split(/(\s+)/); // keep whitespace as tokens
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length <= width) {
      current += word;
    } else if (current.length === 0) {
      // Single word longer than width — hard break
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
    } else {
      lines.push(current);
      current = word.trimStart(); // don't start new line with whitespace
    }
  }
  if (current) lines.push(current);
  return lines;
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
  { name: "caveman", desc: "cycle token saving" },
  { name: "clear", desc: "clear chat" },
  { name: "exit", desc: "quit" },
];

export class App {
  private screen: Screen;
  private keypress: KeypressHandler;
  private input: InputWidget;
  private messages: ChatMessage[] = [];
  private thinkingBuffer = "";
  private thinkingStartTime = 0;
  private thinkingDuration = 0;
  private todoItems: Array<{ id: string; text: string; status: "pending" | "in_progress" | "done" }> = [];
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
  private questionPrompt: { question: string; options?: string[]; cursor: number; textInput: string; resolve: (answer: string) => void } | null = null;
  private pendingImages: Array<{ mimeType: string; data: string }> = [];
  private gitBranch = "";
  private gitDirty = false;
  private sessionName = "New Session";
  private appVersion = "0.0.1";
  private mcpConnections: string[] = [];
  private onCycleScopedModel: (() => void) | null = null;
  private mode: Mode = "build";
  private onModeChange: ((mode: Mode) => void) | null = null;
  private onThinkingChange: ((level: ThinkingLevel) => void) | null = null;
  private onCavemanChange: ((level: CavemanLevel) => void) | null = null;
  private pendingMessages: Array<{ text: string; images?: Array<{ mimeType: string; data: string }> }> = [];
  private onPendingMessagesReady: (() => void) | null = null;
  private streamStartTime = 0;
  private streamTokens = 0;
  private toolCallGroups: Array<{ name: string; preview: string; args?: unknown; resultDetail?: string; result?: string; error?: boolean; expanded: boolean; streamOutput?: string }> = [];
  private allToolsExpanded = false;
  private isCompacting = false;
  private escPrimed = false;
  private compactStartTime = 0;
  private compactTokens = 0;
  private sidebarFileTree: Array<{ name: string; isDir: boolean; children?: string[]; depth: number }> | null = null;
  private sidebarExpandedDirs = new Set<string>();
  private sidebarTreeOpen = true;

  // Animated counters
  private animTokens = new AnimCounter();
  private animCost = new AnimCounter();
  private animStreamTokens = new AnimCounter();
  private animContext = new AnimCounter();

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
    // Shorten long model names
    // e.g. ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M -> gemma-4-E4B-it
    if (model.includes("/")) {
      model = model.split("/").pop()!;
    }
    // Strip GGUF suffix and quantization tag (e.g. "-GGUF:Q4_K_M")
    model = model.replace(/-GGUF(:[^\s]*)?/g, "");
    // Strip trailing colon artifacts
    model = model.replace(/:$/, "");
    this.modelName = model;
    this.draw();
  }

  updateCost(cost: number, tokens: number): void {
    this.sessionCost = cost;
    this.sessionTokens = tokens;
    this.animCost.set(cost);
    this.animTokens.set(tokens);
    this.draw();
  }

  resetCost(): void {
    this.sessionCost = 0;
    this.sessionTokens = 0;
    this.contextUsed = 0;
    this.animCost.reset();
    this.animTokens.reset();
    this.animStreamTokens.reset();
    this.animContext.reset();
    this.draw();
  }

  setContextUsed(pct: number): void {
    this.contextUsed = pct;
    this.animContext.set(pct);
    this.draw();
  }

  setStreaming(streaming: boolean): void {
    this.isStreaming = streaming;
    if (!streaming) {
      // Capture thinking duration before clearing
      if (this.thinkingStartTime > 0) {
        this.thinkingDuration = Math.floor((Date.now() - this.thinkingStartTime) / 1000);
        this.thinkingStartTime = 0;
      } else {
        this.thinkingDuration = 0;
      }
      this.thinkingBuffer = "";
      // Collapse tool call groups into single summary message
      if (this.toolCallGroups.length > 0) {
        this.collapseToolCalls();
      }
      // Show completion message with elapsed time + tokens + thinking
      if (this.streamStartTime > 0) {
        const elapsed = Date.now() - this.streamStartTime;
        const secs = Math.floor(elapsed / 1000);
        const mins = Math.floor(secs / 60);
        const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
        const extras: string[] = [];
        if (this.streamTokens > 0) extras.push(`${fmtTokens(this.streamTokens)} tokens`);
        if (this.thinkingDuration > 0) extras.push(`thought for ${this.thinkingDuration}s`);
        const extraStr = extras.length > 0 ? ` \u00B7 ${extras.join(" \u00B7 ")}` : "";
        this.messages.push({ role: "system", content: `${DIM}\u2726 Churned for ${timeStr}${extraStr}${RESET}` });
        this.invalidateMsgCache();
        this.streamStartTime = 0;
      }
    }
    if (streaming) {
      this.thinkingBuffer = "";
      this.thinkingStartTime = 0;
      this.thinkingDuration = 0;
      this.spinnerFrame = 0;
      this.streamStartTime = Date.now();
      this.streamTokens = 0;
      this.animStreamTokens.reset();
      this.toolCallGroups = [];
      this.spinnerTimer = setInterval(() => {
        this.spinnerFrame++;
        this.animTokens.tick();
        this.animCost.tick();
        this.animStreamTokens.tick();
        this.animContext.tick();
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

  setSessionName(name: string): void { this.sessionName = name; }
  setVersion(v: string): void { this.appVersion = v; }
  setMcpConnections(conns: string[]): void { this.mcpConnections = conns; }

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
    // Capture thinking duration when first text arrives after thinking
    if (this.thinkingStartTime > 0 && this.thinkingBuffer) {
      this.thinkingDuration = Math.floor((Date.now() - this.thinkingStartTime) / 1000);
      this.thinkingStartTime = 0;
      this.thinkingBuffer = "";
    }
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
    if (!this.thinkingBuffer && delta) {
      this.thinkingStartTime = Date.now();
    }
    this.thinkingBuffer += delta;
    this.scrollToBottom();
    this.draw();
  }

  /** Update the TODO task list */
  updateTodo(items: Array<{ id: string; text: string; status: "pending" | "in_progress" | "done" }>): void {
    this.todoItems = items;
    this.invalidateMsgCache();
    this.draw();
  }

  /** Track a tool call — rendered inline immediately */
  addToolCall(name: string, preview: string, args?: unknown): void {
    this.toolCallGroups.push({ name, preview, args, expanded: this.allToolsExpanded });
    // Render inline as system message immediately
    const maxW = this.screen.mainWidth - 4;
    const tc = this.toolCallGroups[this.toolCallGroups.length - 1];
    const block = this.renderToolCallBlock(tc, maxW);
    if (block.length > 0) {
      this.messages.push({ role: "system", content: block.join("\n") });
    }
    this.invalidateMsgCache();
    this.scrollToBottom();
    this.draw();
  }

  /** Update a pending tool call with real args once they're fully streamed */
  updateToolCallArgs(name: string, preview: string, args: unknown): void {
    for (let i = this.toolCallGroups.length - 1; i >= 0; i--) {
      const tc = this.toolCallGroups[i];
      if (tc.name === name && !tc.result) {
        tc.preview = preview;
        tc.args = args;
        // Update the inline message
        const maxW = this.screen.mainWidth - 4;
        const block = this.renderToolCallBlock(tc, maxW);
        for (let j = this.messages.length - 1; j >= 0; j--) {
          if (this.messages[j].role === "system" && this.messages[j].content.includes("...")) {
            this.messages[j].content = block.join("\n");
            break;
          }
        }
        this.invalidateMsgCache();
        this.draw();
        return;
      }
    }
    // Fallback: if no pending tool call found, add as new
    this.addToolCall(name, preview, args);
  }

  /** Track a tool result — update the inline message */
  addToolResult(name: string, result: string, error?: boolean, resultDetail?: string): void {
    // Update the tracking entry
    for (let i = this.toolCallGroups.length - 1; i >= 0; i--) {
      if (this.toolCallGroups[i].name === name && !this.toolCallGroups[i].result) {
        this.toolCallGroups[i].result = result;
        this.toolCallGroups[i].error = error;
        this.toolCallGroups[i].resultDetail = resultDetail;
        // Update the corresponding inline message
        const maxW = this.screen.mainWidth - 4;
        const block = this.renderToolCallBlock(this.toolCallGroups[i], maxW);
        // Find the matching system message (search from end)
        for (let j = this.messages.length - 1; j >= 0; j--) {
          if (this.messages[j].role === "system" && this.messages[j].content.includes(this.toolCallGroups[i].preview)) {
            this.messages[j].content = block.join("\n");
            break;
          }
        }
        break;
      }
    }
    this.invalidateMsgCache();
    this.scrollToBottom();
    this.draw();
  }

  setStreamTokens(tokens: number): void {
    this.streamTokens = tokens;
    this.animStreamTokens.set(tokens);
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

  /** Append streaming bash output to the latest running bash tool call */
  appendToolOutput(chunk: string): void {
    for (let i = this.toolCallGroups.length - 1; i >= 0; i--) {
      const tc = this.toolCallGroups[i];
      if (tc.name === "bash" && !tc.result) {
        tc.streamOutput = (tc.streamOutput ?? "") + chunk;
        // Update the corresponding inline message
        const maxW = this.screen.mainWidth - 4;
        const block = this.renderToolCallBlock(tc, maxW);
        for (let j = this.messages.length - 1; j >= 0; j--) {
          if (this.messages[j].role === "system" && this.messages[j].content.includes(tc.preview)) {
            this.messages[j].content = block.join("\n");
            break;
          }
        }
        this.invalidateMsgCache();
        this.scrollToBottom();
        this.draw();
        return;
      }
    }
  }

  /** Clear tool call tracking after streaming ends */
  private collapseToolCalls(): void {
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

  onThinkingToggle(callback: (level: ThinkingLevel) => void): void {
    this.onThinkingChange = callback;
  }

  private cycleThinkingMode(): void {
    const levels: ThinkingLevel[] = ["off", "low", "medium", "high"];
    const settings = getSettings();
    const current = settings.thinkingLevel || (settings.enableThinking ? "low" : "off");
    const idx = levels.indexOf(current);
    const next = levels[(idx + 1) % levels.length];
    updateSetting("thinkingLevel", next);
    updateSetting("enableThinking", next !== "off");
    if (this.onThinkingChange) this.onThinkingChange(next);
    this.draw();
  }

  onCavemanToggle(callback: (level: CavemanLevel) => void): void {
    this.onCavemanChange = callback;
  }

  cycleCavemanMode(): void {
    const levels: CavemanLevel[] = ["off", "lite", "full", "ultra"];
    const settings = getSettings();
    const current = settings.cavemanLevel ?? "off";
    const idx = levels.indexOf(current);
    const next = levels[(idx + 1) % levels.length];
    updateSetting("cavemanLevel", next);
    if (this.onCavemanChange) this.onCavemanChange(next);
    this.draw();
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
    // Block input during compacting (only allow Ctrl+C to exit)
    if (this.isCompacting) {
      if (key.ctrl && key.name === "c") {
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
      }
      return;
    }

    // Question prompt (model asked user a question)
    if (this.questionPrompt) {
      const qp = this.questionPrompt;
      if (qp.options) {
        // Multiple choice
        if (key.name === "up") {
          qp.cursor = Math.max(0, qp.cursor - 1);
          this.draw();
        } else if (key.name === "down") {
          qp.cursor = Math.min(qp.options.length - 1, qp.cursor + 1);
          this.draw();
        } else if (key.name === "return") {
          const answer = qp.options[qp.cursor];
          this.questionPrompt = null;
          this.addMessage("system", `${DIM}> ${answer}${RESET}`);
          this.invalidateMsgCache();
          this.draw();
          qp.resolve(answer);
        } else if (key.name === "escape") {
          this.questionPrompt = null;
          this.addMessage("system", `${DIM}> [skipped]${RESET}`);
          this.invalidateMsgCache();
          this.draw();
          qp.resolve("[user skipped]");
        }
      } else {
        // Free text input
        if (key.name === "return") {
          const answer = qp.textInput.trim() || "[no answer]";
          this.questionPrompt = null;
          this.addMessage("system", `${DIM}> ${answer}${RESET}`);
          this.invalidateMsgCache();
          this.draw();
          qp.resolve(answer);
        } else if (key.name === "escape") {
          this.questionPrompt = null;
          this.addMessage("system", `${DIM}> [skipped]${RESET}`);
          this.invalidateMsgCache();
          this.draw();
          qp.resolve("[user skipped]");
        } else if (key.name === "backspace") {
          if (qp.textInput.length > 0) {
            qp.textInput = qp.textInput.slice(0, -1);
            this.draw();
          }
        } else if (key.char && !key.ctrl && !key.meta && key.char.length === 1) {
          qp.textInput += key.char;
          this.draw();
        }
      }
      return;
    }

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

    // ESC to interrupt streaming (single press)
    if (key.name === "escape" && this.isStreaming && this.onAbort) {
      this.onAbort();
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

    // Ctrl+O — toggle all tool output expanded/collapsed
    if (key.ctrl && key.name === "o") {
      this.allToolsExpanded = !this.allToolsExpanded;
      this.toolOutputCollapsed = !this.allToolsExpanded;
      // Update all current tool calls
      for (const tc of this.toolCallGroups) {
        tc.expanded = this.allToolsExpanded;
      }
      this.invalidateMsgCache();
      this.draw();
      return;
    }

    // Mouse click — handle sidebar clicks
    if (key.name === "click" && key.char) {
      const [colStr, rowStr] = key.char.split(",");
      const col = parseInt(colStr, 10);
      const row = parseInt(rowStr, 10);
      const hasSB = this.screen.hasSidebar && this.messages.length > 0 && !getSettings().hideSidebar;
      if (hasSB && col > this.screen.mainWidth) {
        // Determine which sidebar row was clicked
        const sidebarLines = this.renderSidebar();
        const clickedLine = sidebarLines[row - 1]; // 1-based rows
        if (clickedLine) {
          const plain = stripAnsi(clickedLine).trim();
          // Click on "▼ Files" / "▶ Files" — toggle whole tree
          if (plain.startsWith("\u25BC Files") || plain.startsWith("\u25B6 Files")) {
            this.sidebarTreeOpen = !this.sidebarTreeOpen;
          }
          // Click on a folder "▶ dirname/" or "▼ dirname/" — toggle that folder
          else if (plain.match(/^[\u25BC\u25B6] .+\/$/)) {
            const dirName = plain.slice(2).replace(/\/$/, "");
            if (this.sidebarExpandedDirs.has(dirName)) {
              this.sidebarExpandedDirs.delete(dirName);
            } else {
              this.sidebarExpandedDirs.add(dirName);
            }
          }
          // Click on "▶ +N more" — expand all children of that dir
          else if (plain.match(/^[\u25B6] \+\d+ more$/)) {
            // Find which dir this belongs to by scanning backwards
            for (let i = row - 2; i >= 0; i--) {
              const prevPlain = stripAnsi(sidebarLines[i] ?? "").trim();
              if (prevPlain.match(/^[\u25BC] .+\/$/)) {
                const dirName = prevPlain.slice(2).replace(/\/$/, "");
                this.sidebarExpandedDirs.add(`${dirName}:all`);
                break;
              }
            }
          }
        }
        this.draw();
      }
      return;
    }

    // Shift+Tab — toggle between build and plan mode
    if (key.shift && key.name === "tab") {
      this.mode = this.mode === "build" ? "plan" : "build";
      if (this.onModeChange) this.onModeChange(this.mode);
      this.draw();
      return;
    }

    // Scroll: mouse wheel, PageUp/Down, Ctrl+Up/Down
    if (key.name === "scrollup" || key.name === "pageup" || (key.ctrl && key.name === "up")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 3);
      this.invalidateMsgCache();
      this.draw();
      return;
    }
    if (key.name === "scrolldown" || key.name === "pagedown" || (key.ctrl && key.name === "down")) {
      const chatHeight = this.getChatHeight();
      const messageLines = this.renderMessages(this.screen.mainWidth - 2);
      const maxScroll = Math.max(0, messageLines.length - chatHeight);
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 3);
      this.invalidateMsgCache();
      this.draw();
      return;
    }

    // Ctrl+T — cycle thinking mode
    if (key.ctrl && key.name === "t") {
      this.cycleThinkingMode();
      return;
    }

    // Ctrl+Y — cycle caveman mode
    if (key.ctrl && key.name === "y") {
      this.cycleCavemanMode();
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
        const availW = maxWidth - 4; // "  > " prefix
        const contentLines = content.split("\n");
        for (let li = 0; li < contentLines.length; li++) {
          const prefix = li === 0 ? "  > " : "    ";
          const wrapped = wordWrap(contentLines[li], availW);
          for (let wi = 0; wi < wrapped.length; wi++) {
            const pfx = wi === 0 ? prefix : "    ";
            const text = wrapped[wi];
            const padW = Math.max(0, maxWidth - text.length - pfx.length);
            lines.push(`${bg(30, 30, 30)}${BOLD}${WHITE}${pfx}${text}${" ".repeat(padW)}${RESET}`);
          }
        }
        lines.push("");
      } else if (msg.role === "assistant") {
        const rendered = renderMarkdown(msg.content);
        const wrapW = maxWidth - 4; // 2 indent + 2 margin
        for (const cl of rendered.split("\n")) {
          const plain = stripAnsi(cl);
          if (plain.length <= wrapW) {
            lines.push(`  ${cl}`);
          } else {
            // Word-aware soft wrap
            for (const wl of wordWrap(plain, wrapW)) {
              lines.push(`  ${wl}`);
            }
          }
        }
        if (idx + 1 < this.messages.length && this.messages[idx + 1].role === "user") {
          lines.push("");
          lines.push(`${DIM}  ${"─".repeat(Math.max(1, maxWidth - 4))}${RESET}`);
        }
      } else if (this.toolOutputCollapsed && this.isToolOutput(msg.content)) {
        while (idx + 1 < this.messages.length
          && this.messages[idx + 1].role === "system"
          && this.isToolOutput(this.messages[idx + 1].content)) {
          idx++;
        }
        lines.push(`${DIM}  [tool output hidden]${RESET}`);
      } else if (msg.content.includes("\x1b[")) {
        // Pre-formatted content (tool blocks with ANSI) — render lines as-is, wrap to width
        const wrapW = maxWidth - 4;
        for (const cl of msg.content.split("\n")) {
          const visLen = stripAnsi(cl).length;
          if (visLen <= wrapW) {
            lines.push(`  ${cl}`);
          } else {
            const plain = stripAnsi(cl);
            // Preserve color prefix from original line
            const colorPrefix = cl.slice(0, cl.indexOf(plain[0]));
            for (let i = 0; i < plain.length; i += wrapW) {
              lines.push(`  ${i === 0 ? colorPrefix : ""}${plain.slice(i, i + wrapW)}${RESET}`);
            }
          }
        }
      } else {
        // Plain system message — wrap to fit
        const wrapW = maxWidth - 4;
        const plain = msg.content;
        if (plain.length <= wrapW) {
          lines.push(`${DIM}  ${plain}${RESET}`);
        } else {
          for (let i = 0; i < plain.length; i += wrapW) {
            lines.push(`${DIM}  ${plain.slice(i, i + wrapW)}${RESET}`);
          }
        }
      }
      lines.push("");
      idx++;
    }
    this.msgCacheLines = lines;
    this.msgCacheWidth = maxWidth;
    this.msgCacheLen = this.messages.length;
    return lines;
  }

  /** Descriptive tool call label */
  private toolDescription(tc: typeof this.toolCallGroups[0]): string {
    const a = tc.args as Record<string, string> | undefined;
    switch (tc.name) {
      case "readFile": return `Reading ${tc.preview}`;
      case "listFiles": return `Listing ${tc.preview}`;
      case "grep": return `Searching for ${a?.pattern ? `"${a.pattern}"` : "pattern"}`;
      case "writeFile": return `Writing ${tc.preview}`;
      case "editFile": return `Updating ${tc.preview}`;
      case "bash": return `Running \`${tc.preview}\``;
      case "webSearch": return `Searching web for "${a?.query ?? tc.preview}"`;
      case "webFetch": return `Fetching ${a?.url ?? tc.preview}`;
      case "askUser": return `Asking: ${a?.question ?? tc.preview}`;
      case "todoWrite": return `Updating task list`;
      default: return `${tc.name} ${tc.preview}`;
    }
  }

  /** Render a tool call block — green circle running, grey circle done, red circle error */
  private renderToolCallBlock(tc: typeof this.toolCallGroups[0], maxWidth: number): string[] {
    const lines: string[] = [];
    const done = !!tc.result;
    const running = !done;
    const L = "\u2514"; // └

    // Icon: green circle (running/blinking), dim circle (done), red circle (error)
    const icon = tc.error ? `${RED}\u25CF${RESET}`
      : done ? `${DIM}\u25CF${RESET}`
      : (this.spinnerFrame % 2 === 0 ? `${GREEN}\u25CF${RESET}` : `${GREEN_DIM}\u25CF${RESET}`);

    const desc = this.toolDescription(tc);
    lines.push(`  ${icon} ${done ? DIM : WHITE}${desc}${running ? "..." : ""}${RESET}`);

    const a = tc.args as Record<string, string> | undefined;

    // --- Streaming bash output (show last lines while running) ---
    if (tc.name === "bash" && running && tc.streamOutput) {
      const outLines = tc.streamOutput.split("\n").filter(l => l.trim());
      const tail = outLines.slice(-5);
      for (const l of tail) {
        lines.push(`${DIM}  ${L} ${l.slice(0, maxWidth - 6)}${RESET}`);
      }
      if (outLines.length > 5) {
        lines.push(`${DIM}  ${L} ... +${outLines.length - 5} lines${RESET}`);
      }
    }

    // --- Running non-bash: show "Running..." ---
    if (running && tc.name !== "bash") {
      // No extra detail while running
    }

    // --- Completed output ---
    if (done) {
      if (tc.name === "editFile" && a?.old_string && a?.new_string) {
        const oldLines = a.old_string.split("\n");
        const newLines = a.new_string.split("\n");
        const diffW = maxWidth - 6;

        // Always show diff inline (like Claude Code screenshots)
        lines.push(`${DIM}  ${L} +${newLines.length} -${oldLines.length} lines${RESET}`);
        // Show removed lines (red bg)
        for (const l of oldLines.slice(0, 4)) {
          const text = `- ${l}`.slice(0, diffW - 2);
          const pad = Math.max(0, diffW - 2 - text.length);
          lines.push(`  ${bg(60, 15, 15)} ${text}${" ".repeat(pad)} ${RESET}`);
        }
        if (oldLines.length > 4) lines.push(`${DIM}      ... +${oldLines.length - 4} more${RESET}`);
        // Show added lines (green bg)
        for (const l of newLines.slice(0, 4)) {
          const text = `+ ${l}`.slice(0, diffW - 2);
          const pad = Math.max(0, diffW - 2 - text.length);
          lines.push(`  ${bg(15, 45, 15)} ${text}${" ".repeat(pad)} ${RESET}`);
        }
        if (newLines.length > 4) lines.push(`${DIM}      ... +${newLines.length - 4} more${RESET}`);
      } else if (tc.name === "writeFile" && a?.content) {
        const n = a.content.split("\n").length;
        lines.push(`${DIM}  ${L} ${n} lines written${RESET}`);
      } else if (tc.name === "bash" && tc.streamOutput) {
        // Show last few lines of output collapsed
        const outLines = tc.streamOutput.split("\n").filter(l => l.trim());
        if (tc.expanded) {
          const showLines = outLines.slice(-20);
          if (outLines.length > 20) lines.push(`${DIM}    ... ${outLines.length - 20} earlier lines${RESET}`);
          for (const l of showLines) {
            lines.push(`${DIM}  ${L} ${l.slice(0, maxWidth - 6)}${RESET}`);
          }
        } else {
          const tail = outLines.slice(-3);
          for (const l of tail) {
            lines.push(`${DIM}  ${L} ${l.slice(0, maxWidth - 6)}${RESET}`);
          }
          if (outLines.length > 3) {
            lines.push(`${DIM}  ${L} ... +${outLines.length - 3} lines (ctrl+o to expand)${RESET}`);
          }
        }
      } else if (tc.resultDetail) {
        lines.push(`${DIM}  ${L} ${tc.resultDetail.slice(0, maxWidth - 6)}${RESET}`);
      }
    }

    if (tc.error && tc.result) {
      lines.push(`${RED}  ${L} ${tc.result}${RESET}`);
    }

    return lines;
  }

  /** Render messages + dynamic overlays (tool calls, thinking, loading) */
  private renderMessages(maxWidth: number): string[] {
    const lines = [...this.renderStaticMessages(maxWidth)];

    // Thinking block — show reasoning as it streams in
    if (this.thinkingBuffer) {
      const thinkLines = this.thinkingBuffer.split("\n").slice(-3);
      lines.push(`  ${T()}thinking${RESET}`);
      for (const tl of thinkLines) {
        lines.push(`  ${DIM}${tl.slice(0, maxWidth - 4)}${RESET}`);
      }
      lines.push("");
    }

    // TODO task list — show when tasks exist
    if (this.todoItems.length > 0) {
      const done = this.todoItems.filter(t => t.status === "done").length;
      const total = this.todoItems.length;
      const spinChars = ["\u25DC", "\u25DD", "\u25DE", "\u25DF"];
      const spin = spinChars[this.spinnerFrame % spinChars.length];
      const allDone = done === total;

      // Header line
      if (this.isStreaming) {
        const elapsed = Date.now() - this.streamStartTime;
        const secs = Math.floor(elapsed / 1000);
        const mins = Math.floor(secs / 60);
        const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
        const inProgress = this.todoItems.find(t => t.status === "in_progress");
        const headerText = inProgress ? inProgress.text : (allDone ? "Done" : "Working...");
        lines.push(`  ${T()}${spin}${RESET} ${T()}${headerText}${RESET}  ${DIM}${timeStr} \u00B7 ${done}/${total}${RESET}`);
      } else {
        lines.push(`  ${allDone ? GREEN : T()}\u2714${RESET} ${DIM}Tasks ${done}/${total}${RESET}`);
      }
      // Task items
      for (let i = 0; i < this.todoItems.length; i++) {
        const item = this.todoItems[i];
        const isLast = i === this.todoItems.length - 1;
        const branch = isLast ? "\u2514" : "\u251C"; // └ or ├
        const icon = item.status === "done" ? `${GREEN}\u25A0${RESET}` // ■ green
          : item.status === "in_progress" ? `${T()}${spin}${RESET}` // spinner
          : `${DIM}\u25A1${RESET}`; // □ dim
        const textColor = item.status === "done" ? DIM : item.status === "in_progress" ? WHITE : DIM;
        lines.push(`  ${DIM}${branch}${RESET} ${icon} ${textColor}${item.text.slice(0, maxWidth - 10)}${RESET}`);
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

    // Streaming status — ALWAYS pinned at bottom while generating
    if (this.isStreaming) {
      const elapsed = Date.now() - this.streamStartTime;
      const secs = Math.floor(elapsed / 1000);
      const mins = Math.floor(secs / 60);
      const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
      const statParts: string[] = [timeStr];
      const animTok = this.animStreamTokens.getInt();
      if (animTok > 0) statParts.push(`\u2193 ${fmtTokens(animTok)} tokens`);
      // Show thinking duration
      if (this.thinkingStartTime > 0) {
        // Still thinking — show live
        const thinkSecs = Math.floor((Date.now() - this.thinkingStartTime) / 1000);
        if (thinkSecs > 0) statParts.push(`thinking ${thinkSecs}s`);
      } else if (this.thinkingDuration > 0) {
        statParts.push(`thought for ${this.thinkingDuration}s`);
      }
      const stats = statParts.join(" \u00B7 ");
      const sparkle = this.sparkleSpinner(this.spinnerFrame);
      // Label: "Thinking..." while thinking, "Composing..." while outputting text
      const label = this.thinkingBuffer ? "Thinking..." : "Composing...";
      const shimmer = this.shimmerText(label, this.spinnerFrame);
      lines.push(`  ${sparkle} ${shimmer} ${T()}(${stats})${RESET}`);
      lines.push("");
    }
    return lines;
  }

  private renderCompactHeader(): string {
    const model = `${T()}${this.providerName}/${this.modelName}${RESET}`;
    const git = this.gitBranch ? ` ${DIM}${this.gitBranch}${this.gitDirty ? "*" : ""}${RESET}` : "";
    return ` ${model}${git}`;
  }

  /** Render the sidebar content */
  private renderSidebar(): string[] {
    const w = this.screen.sidebarWidth;
    const lines: string[] = [];

    // Session name + version
    lines.push(`${WHITE}${BOLD}${this.sessionName.slice(0, w - 2)}${RESET}`);
    lines.push(`${DIM}v${this.appVersion}${RESET}`);
    lines.push("");

    // Model
    lines.push(`${T()}${this.providerName}/${this.modelName}${RESET}`);
    lines.push("");

    // Providers
    if (this.detectedProviders.length > 0) {
      lines.push(`${WHITE}Providers${RESET}`);
      for (const p of this.detectedProviders.slice(0, 4)) {
        lines.push(`  ${DIM}${p}${RESET}`);
      }
      if (this.detectedProviders.length > 4) {
        lines.push(`  ${DIM}+${this.detectedProviders.length - 4} more${RESET}`);
      }
      lines.push("");
    }

    // MCP connections
    if (this.mcpConnections.length > 0) {
      lines.push(`${WHITE}MCP${RESET}`);
      for (const c of this.mcpConnections.slice(0, 3)) {
        lines.push(`  ${GREEN}\u25CF${RESET} ${DIM}${c.slice(0, w - 6)}${RESET}`);
      }
      lines.push("");
    }

    // Directory
    lines.push(`${WHITE}Directory${RESET}`);
    const shortCwd = this.cwd.length > w - 2
      ? "~" + this.cwd.slice(-(w - 3))
      : this.cwd;
    lines.push(`  ${DIM}${shortCwd}${RESET}`);
    if (this.gitBranch) {
      lines.push(`  ${DIM}${this.gitBranch}${this.gitDirty ? " *" : ""}${RESET}`);
    }
    lines.push("");

    // File tree (collapsible)
    const treeArrow = this.sidebarTreeOpen ? "\u25BC" : "\u25B6";
    lines.push(`${WHITE}${treeArrow} Files${RESET}`);
    if (this.sidebarTreeOpen) {
      if (!this.sidebarFileTree) {
        try {
          const files = execSync("git ls-files --others --cached --exclude-standard", { cwd: this.cwd, encoding: "utf-8", timeout: 2000 }).trim();
          const raw = files.split("\n").filter(Boolean);
          const dirContents = new Map<string, string[]>();
          const topFiles: string[] = [];
          for (const f of raw) {
            const slash = f.indexOf("/");
            if (slash > 0) {
              const dir = f.slice(0, slash);
              if (!dirContents.has(dir)) dirContents.set(dir, []);
              dirContents.get(dir)!.push(f.slice(slash + 1));
            } else {
              topFiles.push(f);
            }
          }
          const items: Array<{ name: string; isDir: boolean; children?: string[]; depth: number }> = [];
          for (const dir of [...dirContents.keys()].sort()) {
            const children = dirContents.get(dir)!.sort().map(c => c.includes("/") ? c.split("/").pop()! : c);
            items.push({ name: dir, isDir: true, children, depth: 0 });
          }
          for (const f of topFiles.sort()) {
            items.push({ name: f, isDir: false, depth: 0 });
          }
          this.sidebarFileTree = items;
        } catch {
          try {
            const { readdirSync, statSync } = require("fs");
            const { join: pathJoin } = require("path");
            this.sidebarFileTree = readdirSync(this.cwd)
              .filter((f: string) => !f.startsWith(".") && f !== "node_modules")
              .map((f: string) => {
                const isD = (() => { try { return statSync(pathJoin(this.cwd, f)).isDirectory(); } catch { return false; } })();
                return { name: f, isDir: isD, children: isD ? [] : undefined, depth: 0 };
              })
              .slice(0, 30) as typeof this.sidebarFileTree;
          } catch {
            this.sidebarFileTree = [];
          }
        }
      }
      const tree = this.sidebarFileTree ?? [];
      let lineCount = 0;
      const maxLines = 25;
      for (const item of tree) {
        if (lineCount >= maxLines) { lines.push(`  ${DIM}+${tree.length - lineCount} more${RESET}`); break; }
        if (item.isDir) {
          const expanded = this.sidebarExpandedDirs.has(item.name);
          const arrow = expanded ? "\u25BC" : "\u25B6";
          const display = item.name.length > w - 6 ? item.name.slice(-(w - 7)) : item.name;
          lines.push(`  ${T()}${arrow} ${display}/${RESET}`);
          lineCount++;
          if (expanded && item.children) {
            const showCount = this.sidebarExpandedDirs.has(`${item.name}:all`) ? item.children.length : Math.min(item.children.length, 5);
            for (let i = 0; i < showCount; i++) {
              if (lineCount >= maxLines) break;
              const child = item.children[i];
              const cDisplay = child.length > w - 8 ? child.slice(-(w - 9)) : child;
              lines.push(`    ${DIM}${cDisplay}${RESET}`);
              lineCount++;
            }
            if (showCount < item.children.length) {
              const remaining = item.children.length - showCount;
              lines.push(`    ${DIM}\u25B6 +${remaining} more${RESET}`);
              lineCount++;
            }
          }
        } else {
          const display = item.name.length > w - 4 ? item.name.slice(-(w - 5)) : item.name;
          lines.push(`  ${DIM}${display}${RESET}`);
          lineCount++;
        }
      }
    }

    return lines;
  }

  /** Pad or truncate a visible string to a target width */
  private padLine(line: string, targetWidth: number): string {
    const visible = stripAnsi(line).length;
    if (visible > targetWidth) {
      // Truncate: walk through chars counting visible width
      let count = 0;
      let i = 0;
      while (i < line.length && count < targetWidth) {
        if (line[i] === "\x1b") {
          // Skip ANSI escape sequence
          const end = line.indexOf("m", i);
          if (end !== -1) { i = end + 1; continue; }
        }
        count++;
        i++;
      }
      return line.slice(0, i) + RESET;
    }
    if (visible < targetWidth) return line + " ".repeat(targetWidth - visible);
    return line;
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
    const hasSidebar = this.screen.hasSidebar && this.messages.length > 0 && !getSettings().hideSidebar;
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

    // Question prompt from model
    if (this.questionPrompt) {
      const qp = this.questionPrompt;
      bottomLines.push(` ${T()}?${RESET} ${WHITE}${BOLD}${qp.question}${RESET}`);
      if (qp.options) {
        for (let i = 0; i < qp.options.length; i++) {
          const isCursor = i === qp.cursor;
          const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
          const color = isCursor ? `${WHITE}${BOLD}` : DIM;
          bottomLines.push(` ${arrow}${color}${qp.options[i]}${RESET}`);
        }
        bottomLines.push(` ${DIM}enter select, esc skip${RESET}`);
      } else {
        bottomLines.push(` ${T()} > ${RESET}${qp.textInput}`);
        bottomLines.push(` ${DIM}enter submit, esc skip${RESET}`);
      }
    }

    // Pickers appear below input
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
        parts.push({ text: `${DIM}esc${RESET} ${DIM}stop${RESET}`, plain: "esc stop", priority: 0 });
      }
      parts.push({ text: `${modeColor}${modeLabel}${RESET} ${DIM}(shift+tab)${RESET}`, plain: `${modeLabel} (shift+tab)`, priority: 1 });
      if (this.pendingMessages.length > 0) {
        parts.push({ text: `${P()}${this.pendingMessages.length} queued${RESET}`, plain: `${this.pendingMessages.length} queued`, priority: 2 });
      }
      const settings = getSettings();
      const thinkLevel = settings.thinkingLevel || (settings.enableThinking ? "low" : "off");
      if (thinkLevel !== "off") {
        parts.push({ text: `${T()}${thinkLevel}${RESET} ${DIM}(ctrl+t)${RESET}`, plain: `${thinkLevel} (ctrl+t)`, priority: 3 });
      } else {
        parts.push({ text: `${DIM}off${RESET} ${DIM}(ctrl+t)${RESET}`, plain: "off (ctrl+t)", priority: 3 });
      }
      const caveLevel = settings.cavemanLevel ?? "off";
      if (caveLevel !== "off") {
        parts.push({ text: `\u{1FAA8}:${YELLOW}${caveLevel}${RESET} ${DIM}(ctrl+y)${RESET}`, plain: `\u{1FAA8}:${caveLevel} (ctrl+y)`, priority: 3 });
      }
      // Cost/tokens/context in bottom bar — animated values
      const liveTokens = this.animTokens.getInt() + this.animStreamTokens.getInt();
      const showCost = settings.showCost && this.sessionCost > 0;
      const showTokens = settings.showTokens && liveTokens > 0;
      if (showCost || showTokens) {
        const costPart = showCost ? fmtCost(this.animCost.get()) : "";
        const tokPart = showTokens ? `${fmtTokens(liveTokens)} tok` : "";
        const statStr = [costPart, tokPart].filter(Boolean).join(" ");
        parts.push({ text: `${DIM}${statStr}${RESET}`, plain: statStr, priority: 4 });
      }
      const animCtx = this.animContext.getInt();
      if (animCtx > 0) {
        const ctxColor = animCtx > 90 ? RED : animCtx > 70 ? "\x1b[33m" : DIM;
        parts.push({ text: `${ctxColor}${animCtx}% ctx${RESET}`, plain: `${animCtx}% ctx`, priority: 5 });
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

    // Build the full frame — MUST have exactly `height` lines
    const frameLines: string[] = [];
    const topHeight = Math.max(0, height - bottomLines.length);

    // Compact header when no sidebar
    const showCompactHeader = !hasSidebar && this.modelName !== "none";

    if (isHome) {
      if (showCompactHeader) frameLines.push(this.renderCompactHeader());
      frameLines.push("");
      frameLines.push(`${T()}${BOLD}  BrokeCLI${RESET}`);
      frameLines.push(`${DIM}  AI coding on a budget${RESET}`);
      frameLines.push("");
      while (frameLines.length < topHeight) frameLines.push("");
    } else {
      if (showCompactHeader) frameLines.push(this.renderCompactHeader());

      const chatH = Math.max(1, topHeight - (showCompactHeader ? 1 : 0));
      const messageLines = this.renderMessages(mainW);
      const maxScroll = Math.max(0, messageLines.length - chatH);
      if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;
      if (this.scrollOffset < 0) this.scrollOffset = 0;
      const visibleMsgs = messageLines.slice(this.scrollOffset, this.scrollOffset + chatH);

      if (hasSidebar) {
        const sidebarLines = this.renderSidebar();
        const border = `${DIM}\u2502${RESET}`;
        for (let i = 0; i < chatH; i++) {
          const chatLine = this.padLine(visibleMsgs[i] ?? "", mainW);
          const sidebarLine = sidebarLines[i] ?? "";
          const paddedSidebar = this.padLine(sidebarLine, this.screen.sidebarWidth);
          frameLines.push(`${chatLine} ${border} ${paddedSidebar}`);
        }
      } else {
        for (let i = 0; i < chatH; i++) {
          frameLines.push(visibleMsgs[i] ?? "");
        }
      }
    }

    // Append bottom lines — extend sidebar border through them
    if (hasSidebar) {
      const border = `${DIM}\u2502${RESET}`;
      const sideW = this.screen.sidebarWidth;
      for (const l of bottomLines) {
        const padded = this.padLine(l, mainW);
        frameLines.push(`${padded} ${border}${" ".repeat(sideW + 1)}`);
      }
    } else {
      for (const l of bottomLines) frameLines.push(l);
    }

    // CRITICAL: Ensure exactly `height` lines — pad or truncate
    while (frameLines.length < height) frameLines.push("");
    if (frameLines.length > height) frameLines.length = height;

    this.screen.render(frameLines);

    // Hide cursor during streaming/pickers/compacting — no input focus
    if (this.isStreaming || this.isCompacting || this.modelPicker || this.settingsPicker || this.itemPicker || this.questionPrompt) {
      this.screen.hideCursor();
      return;
    }

    // Cursor on input line — account for multi-line input
    const textBeforeCursor = inputText.slice(0, cursor);
    const cursorLineIdx = (textBeforeCursor.match(/\n/g) || []).length;
    const lastNewline = textBeforeCursor.lastIndexOf("\n");
    const colInLine = lastNewline >= 0 ? cursor - lastNewline - 1 : cursor;
    const inputRow = Math.min(height, topHeight + 2 + cursorLineIdx); // +1 separator, +1 for 1-based
    const inputCol = Math.min(width, 4 + colInLine);
    this.screen.setCursor(inputRow, inputCol);
  }

  /** Sparkle spinner: cycles through · ✧ ✦ ✧ one at a time */
  private sparkleSpinner(frame: number, color?: string): string {
    const chars = ["\u00B7", "\u2727", "\u2726", "\u2727"]; // · ✧ ✦ ✧
    const c = color ?? T();
    return `${c}${chars[frame % chars.length]}${RESET}`;
  }

  /** Shimmer effect — color wave sweeping across text */
  private shimmerText(text: string, frame: number): string {
    // Parse theme color RGB for shimmer range
    const themeCol = T();
    const rgbMatch = themeCol.match(/38;2;(\d+);(\d+);(\d+)/);
    const tr = rgbMatch ? parseInt(rgbMatch[1]) : 58;
    const tg = rgbMatch ? parseInt(rgbMatch[2]) : 199;
    const tb = rgbMatch ? parseInt(rgbMatch[3]) : 58;
    // Dim version: 40% brightness
    const dr = Math.round(tr * 0.35);
    const dg = Math.round(tg * 0.35);
    const db = Math.round(tb * 0.35);

    const period = text.length + 8;
    const pos = (frame * 0.6) % period;
    let result = "";
    for (let i = 0; i < text.length; i++) {
      const dist = Math.abs(i - pos);
      const t = Math.max(0, 1 - dist / 4);
      const r = Math.round(dr + t * (tr - dr));
      const g = Math.round(dg + t * (tg - dg));
      const b = Math.round(db + t * (tb - db));
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
      lines.push(` ${DIM}type to search, esc to close${RESET}`);
      return;
    }

    const byProvider = new Map<string, ModelOption[]>();
    for (const opt of filtered) {
      if (!byProvider.has(opt.providerName)) byProvider.set(opt.providerName, []);
      byProvider.get(opt.providerName)!.push(opt);
    }

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
    lines.push(` ${DIM}(${Math.min(picker.cursor + 1, picker.filtered.length)}/${picker.filtered.length} files)${RESET}`);
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
    lines.push(` ${DIM}(${Math.min(picker.cursor + 1, filtered.length)}/${filtered.length}) enter to toggle${RESET}`);
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

  /** Show a question to the user and return a promise that resolves with their answer */
  showQuestion(question: string, options?: string[]): Promise<string> {
    return new Promise((resolve) => {
      this.questionPrompt = {
        question,
        options: options && options.length > 0 ? options : undefined,
        cursor: 0,
        textInput: "",
        resolve,
      };
      this.draw();
    });
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
