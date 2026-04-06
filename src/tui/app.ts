import { Screen } from "./screen.js";
import { KeypressHandler, type Keypress } from "./keypress.js";
import { InputWidget } from "./input.js";
import { RESET, BOLD, DIM, BOX } from "../utils/ansi.js";
import { currentTheme, getPlanColor } from "../core/themes.js";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { matchesBinding, loadKeybindings } from "../core/keybindings.js";
import { getSettings, updateSetting } from "../core/config.js";
import type { Mode, ThinkingLevel, CavemanLevel } from "../core/config.js";
import { Session } from "../core/session.js";
import { dirname, join } from "path";
import stripAnsi from "strip-ansi";
import { renderMarkdown } from "../utils/markdown.js";
import { collectProjectFiles, filterFiles, readFileForContext } from "./file-picker.js";
import { buildSidebarFooterLines, loadSidebarFileTree, type SidebarTreeItem } from "./sidebar.js";
import { fileURLToPath } from "url";

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

interface CommandEntry {
  name: string;
  desc: string;
  aliases?: string[];
}

interface MenuEntry {
  text: string;
  selectIndex?: number;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** Shorthand for theme primary color — called per-render so theme switches take effect. */
function T(): string { return currentTheme().primary; }
function TXT(): string { return currentTheme().text; }
function MUTED(): string { return currentTheme().textMuted; }
function BORDER(): string { return currentTheme().border; }
function USER_BG(): string { return currentTheme().userBubble; }
function USER_TXT(): string { return currentTheme().userText; }
function CODE_BG(): string { return currentTheme().codeBg; }
function APP_BG(): string { return currentTheme().background; }
function ERR(): string { return currentTheme().error; }
function OK(): string { return currentTheme().success; }
function ACCENT_2(): string { return currentTheme().secondary; }
function WARN(): string { return currentTheme().warning; }

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
  sync(): void { this.display = this.target; }
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
    s += i === idx ? `${OK()}\u2022${RESET}` : `${DIM}\u00B7${RESET}`;
  }
  return s;
}

const COMMANDS: CommandEntry[] = [
  { name: "btw", desc: "fork and ask a side question" },
  { name: "connect", desc: "connect provider", aliases: ["login"] },
  { name: "model", desc: "switch model" },
  { name: "settings", desc: "configure options" },
  { name: "notify", desc: "send test notification" },
  { name: "theme", desc: "change color theme" },
  { name: "compact", desc: "compress context" },
  { name: "resume", desc: "resume session (sessions)", aliases: ["sessions"] },
  { name: "name", desc: "name this session" },
  { name: "export", desc: "export or copy transcript" },
  { name: "copy", desc: "copy last response" },
  { name: "undo", desc: "undo last change" },
  { name: "thinking", desc: "cycle thinking" },
  { name: "caveman", desc: "cycle token saving" },
  { name: "clear", desc: "clear chat (new)", aliases: ["new"] },
  { name: "exit", desc: "quit" },
];

const HOME_TIPS = [
  "Use /resume to jump back into an older session.",
  "Use /model to switch providers without leaving the chat.",
  "Use /compact before long refactors to keep token pressure down.",
  "Use /btw to fork a side question without derailing the main thread.",
  "Paste an image path to attach a screenshot to your next prompt.",
];

const APP_DIR = dirname(fileURLToPath(import.meta.url));

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
  private sessionInputTokens = 0;
  private sessionOutputTokens = 0;
  private sessionTokens = 0;
  private contextUsed = 0;
  private contextTokenCount = 0;
  private contextLimitTokens = 0;
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
  private modelPicker: { options: ModelOption[]; cursor: number; query: string; scope: "all" | "scoped" } | null = null;
  private onModelSelect: ((providerId: string, modelId: string) => void) | null = null;
  private onModelPin: ((providerId: string, modelId: string, pinned: boolean) => void) | null = null;
  private settingsPicker: { entries: SettingEntry[]; cursor: number; query: string } | null = null;
  private onSettingToggle: ((key: string) => void) | null = null;
  private filePicker: { files: string[]; filtered: string[]; query: string; cursor: number } | null = null;
  private projectFiles: string[] | null = null;
  private fileContexts: Map<string, string> = new Map();
  private cmdSuggestionCursor = 0;
  private itemPicker: {
    title: string;
    items: PickerItem[];
    cursor: number;
    query: string;
    previewHint?: string;
    onPreview?: (id: string) => void;
    onCancel?: () => void;
    onSecondaryAction?: (id: string) => void;
    secondaryHint?: string;
  } | null = null;
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
  private escTimeout: ReturnType<typeof setTimeout> | null = null;
  private compactStartTime = 0;
  private compactTokens = 0;
  private sidebarFileTree: SidebarTreeItem[] | null = null;
  private sidebarExpandedDirs = new Set<string>();
  private sidebarTreeOpen = true;
  private sidebarScrollOffset = 0;
  private sidebarFocused = false;
  private hideCursorUntil = 0;
  private hideCursorTimer: NodeJS.Timeout | null = null;
  private activeMenuClickTargets = new Map<number, () => void>();
  private homeRecentSessions: Array<{ id: string; cwd: string; model: string; cost: number; updatedAt: number; messageCount: number }> = Session.listRecent(5);
  private homeTip = HOME_TIPS[this.pickHomeTipIndex()];
  private readonly handleResize = (): void => {
    this.screen.forceRedraw([]);
    this.draw();
  };

  // Animated counters
  private animTokens = new AnimCounter();
  private animInputTokens = new AnimCounter();
  private animOutputTokens = new AnimCounter();
  private animCost = new AnimCounter();
  private animStreamTokens = new AnimCounter();
  private animContext = new AnimCounter();

  // Render throttling
  private drawScheduled = false;
  private lastDrawTime = 0;
  private static readonly DRAW_THROTTLE_MS = 16; // ~60fps cap
  private static readonly ANIMATION_INTERVAL_MS = 250;

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

  updateUsage(cost: number, inputTokens: number, outputTokens: number): void {
    this.sessionCost = cost;
    this.sessionInputTokens = inputTokens;
    this.sessionOutputTokens = outputTokens;
    this.sessionTokens = inputTokens + outputTokens;
    this.animCost.set(cost);
    this.animInputTokens.set(inputTokens);
    this.animOutputTokens.set(outputTokens);
    this.animTokens.set(this.sessionTokens);
    if (!this.isStreaming) {
      this.animCost.sync();
      this.animInputTokens.sync();
      this.animOutputTokens.sync();
      this.animTokens.sync();
    }
    this.draw();
  }

  resetCost(): void {
    this.sessionCost = 0;
    this.sessionInputTokens = 0;
    this.sessionOutputTokens = 0;
    this.sessionTokens = 0;
    this.contextUsed = 0;
    this.contextTokenCount = 0;
    this.contextLimitTokens = 0;
    this.animCost.reset();
    this.animInputTokens.reset();
    this.animOutputTokens.reset();
    this.animTokens.reset();
    this.animStreamTokens.reset();
    this.animContext.reset();
    this.draw();
  }

  private getLiveInputTokens(): number {
    return this.animInputTokens.getInt();
  }

  private getLiveOutputTokens(): number {
    return this.animOutputTokens.getInt() + (this.isStreaming ? this.animStreamTokens.getInt() : 0);
  }

  private getLiveTotalTokens(): number {
    return this.getLiveInputTokens() + this.getLiveOutputTokens();
  }

  private renderTokenSummaryParts(): string[] {
    const parts = [
      `↑ ${fmtTokens(this.getLiveInputTokens())} in`,
      `↓ ${fmtTokens(this.getLiveOutputTokens())} out`,
    ];
    const total = this.getLiveTotalTokens();
    if (total > 0) {
      if (this.contextLimitTokens > 0) {
        parts.push(`Σ ${fmtTokens(total)}/${fmtTokens(this.contextLimitTokens)} total`);
      } else {
        parts.push(`Σ ${fmtTokens(total)} total`);
      }
    }
    return parts;
  }

  private renderSidebarFooter(): string[] {
    const settings = getSettings();
    if (!settings.showTokens) return [];
    const width = this.screen.sidebarWidth;
    const statusParts: string[] = [];
    const modeLabel = this.mode === "plan" ? "plan" : "build";
    statusParts.push(modeLabel);
    const thinkLevel = settings.thinkingLevel || (settings.enableThinking ? "low" : "off");
    if (thinkLevel !== "off") statusParts.push(thinkLevel);
    const caveLevel = settings.cavemanLevel ?? "off";
    if (caveLevel !== "off") statusParts.push(`🪨 ${caveLevel}`);
    return buildSidebarFooterLines({
      width,
      statusParts,
      cost: settings.showCost && this.sessionCost > 0 ? fmtCost(this.animCost.get()) : undefined,
      tokenParts: this.renderTokenSummaryParts().filter((part) => !part.startsWith("Σ ")),
      contextUsed: this.contextLimitTokens > 0 ? this.contextUsed : undefined,
      contextUsage: this.contextLimitTokens > 0 ? `${fmtTokens(this.contextTokenCount)}/${fmtTokens(this.contextLimitTokens)}` : undefined,
      colors: {
        accent: T(),
        muted: MUTED(),
        text: TXT(),
        warning: currentTheme().warning,
        error: currentTheme().error,
      },
    });
  }

  private clearInterruptPrompt(): void {
    this.ctrlCCount = 0;
    this.escPrimed = false;
    if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
    if (this.escTimeout) clearTimeout(this.escTimeout);
    this.ctrlCTimeout = null;
    this.escTimeout = null;
  }

  private primeCtrlCExit(): void {
    this.escPrimed = false;
    this.ctrlCCount = 1;
    if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
    this.ctrlCTimeout = setTimeout(() => {
      this.ctrlCCount = 0;
      this.ctrlCTimeout = null;
      this.draw();
    }, 1500);
    this.draw();
  }

  private primeEscapeAbort(): void {
    this.ctrlCCount = 0;
    this.escPrimed = true;
    if (this.escTimeout) clearTimeout(this.escTimeout);
    this.escTimeout = setTimeout(() => {
      this.escPrimed = false;
      this.escTimeout = null;
      this.draw();
    }, 1500);
    this.draw();
  }

  setContextUsage(tokens: number, limit: number): void {
    this.contextTokenCount = tokens;
    this.contextLimitTokens = limit;
    this.contextUsed = limit > 0 ? Math.min(100, Math.round((tokens / limit) * 100)) : 0;
    this.animContext.set(this.contextUsed);
    if (!this.isStreaming) this.animContext.sync();
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
      this.animStreamTokens.reset();
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
      }, App.ANIMATION_INTERVAL_MS);
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
    this.modelPicker = { options, cursor: cursorIdx >= 0 ? cursorIdx : 0, query: "", scope: "all" };
    this.onModelSelect = onSelect;
    this.onModelPin = onPin ?? null;
    this.drawNow();
  }

  openSettings(entries: SettingEntry[], onToggle: (key: string) => void): void {
    this.settingsPicker = { entries, cursor: 0, query: "" };
    this.onSettingToggle = onToggle;
    this.drawNow();
  }

  updateSettings(entries: SettingEntry[]): void {
    if (this.settingsPicker) {
      this.settingsPicker.entries = entries;
      this.draw();
    }
  }

  updateItemPickerItems(items: PickerItem[], focusId?: string): void {
    if (!this.itemPicker) return;
    this.itemPicker.items = items;
    if (focusId) {
      const idx = this.getFilteredItems().findIndex((item) => item.id === focusId);
      this.itemPicker.cursor = idx >= 0 ? idx : 0;
    } else {
      this.itemPicker.cursor = this.clampMenuCursor(this.itemPicker.cursor, this.getFilteredItems().length);
    }
    this.draw();
  }

  openItemPicker(
    title: string,
    items: PickerItem[],
    onSelect: (id: string) => void,
    options?: {
      initialCursor?: number;
      previewHint?: string;
      onPreview?: (id: string) => void;
      onCancel?: () => void;
      onSecondaryAction?: (id: string) => void;
      secondaryHint?: string;
    },
  ): void {
    const cursor = this.clampMenuCursor(options?.initialCursor ?? 0, items.length);
    this.itemPicker = {
      title,
      items,
      cursor,
      query: "",
      previewHint: options?.previewHint,
      onPreview: options?.onPreview,
      onCancel: options?.onCancel,
      onSecondaryAction: options?.onSecondaryAction,
      secondaryHint: options?.secondaryHint,
    };
    this.onItemSelect = onSelect;
    this.drawNow();
  }

  clearMessages(): void {
    this.messages = [];
    this.scrollOffset = 0;
    this.refreshHomeScreenData();
    this.invalidateMsgCache();
    this.screen.forceRedraw([]);
    this.draw();
  }

  addMessage(role: "user" | "assistant" | "system", content: string, images?: Array<{ mimeType: string; data: string }>): void {
    if (role === "user") {
      this.thinkingBuffer = "";
      this.thinkingStartTime = 0;
      this.thinkingDuration = 0;
    }
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
    if (!this.isStreaming) this.animStreamTokens.sync();
  }

  setCompacting(compacting: boolean, tokenCount?: number): void {
    this.isCompacting = compacting;
    if (compacting) {
      this.compactStartTime = Date.now();
      this.compactTokens = tokenCount ?? 0;
      this.invalidateMsgCache();
      this.scrollToBottom();
      if (!this.spinnerTimer) {
        this.spinnerFrame = 0;
        this.spinnerTimer = setInterval(() => {
          this.spinnerFrame++;
          this.draw();
        }, App.ANIMATION_INTERVAL_MS);
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

  cycleThinkingMode(): void {
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
    const levels: CavemanLevel[] = ["off", "lite", "auto", "ultra"];
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
    const hasSidebar = this.shouldShowSidebar();
    const mainW = hasSidebar ? this.screen.mainWidth : this.screen.width;
    const bottomBase = this.getBottomLineCount(mainW, this.screen.height);
    const footerBase = hasSidebar ? this.renderSidebarFooter().length : 0;
    return Math.max(1, this.screen.height - Math.max(bottomBase, footerBase) - headerLines);
  }

  private getBottomLineCount(mainW: number, maxHeight: number): number {
    let count = 0;
    count += 1; // separator above input
    count += this.getWrappedInputLines(this.input.getText(), mainW).length;

    if (this.questionPrompt) {
      count += 1;
      count += 1;
      count += this.questionPrompt.options
        ? this.getQuestionOptionEntries().length + 1
        : this.getWrappedInputLines(this.questionPrompt.textInput, mainW).length + 1;
    }

    if (this.filePicker) {
      count += 1;
      count += Math.min(this.getFilePickerEntries().length, Math.max(0, maxHeight - 4));
      count += 1;
    } else if (this.itemPicker) {
      count += 1;
      count += 1;
      count += this.getItemPickerEntries().length === 0 ? 1 : Math.min(this.getItemPickerEntries().length, 10);
      if (this.itemPicker.previewHint) count += 1;
      if (this.itemPicker.secondaryHint) count += 1;
      count += 1;
    } else if (this.settingsPicker) {
      const filtered = this.getSettingsPickerEntries();
      count += 1;
      count += 1;
      count += filtered.length === 0 ? 1 : Math.min(filtered.length, 6);
      if (filtered.length > 0) count += 2;
    } else if (this.modelPicker) {
      const filtered = this.getModelPickerEntries();
      count += 1;
      count += 1;
      count += filtered.length === 0 ? 3 : Math.min(filtered.length, 12) + 2;
    } else {
      const suggestions = this.getCommandSuggestionEntries();
      if (suggestions.length > 0) count += 1;
      count += suggestions.length;
    }

    count += 1; // separator below input
    count += 1; // info bar
    if (this.statusMessage) count += 1;
    return count;
  }

  private getWrappedInputLines(text: string, width: number): string[] {
    const usableWidth = Math.max(1, width - 4);
    const sourceLines = (text || "").split("\n");
    const wrapped: string[] = [];
    for (const line of sourceLines) {
      const lineParts = line.length === 0 ? [""] : wordWrap(line, usableWidth);
      wrapped.push(...lineParts);
    }
    return wrapped.length > 0 ? wrapped : [""];
  }

  private getInputCursorLayout(text: string, cursor: number, width: number): { lines: string[]; row: number; col: number } {
    const lines = this.getWrappedInputLines(text, width);
    const beforeCursor = text.slice(0, cursor);
    const cursorLines = this.getWrappedInputLines(beforeCursor, width);
    const currentLine = cursorLines[cursorLines.length - 1] ?? "";
    return {
      lines,
      row: Math.max(0, cursorLines.length - 1),
      col: currentLine.length,
    };
  }

  /** Filter model options by search query */
  private getFilteredModels(): ModelOption[] {
    if (!this.modelPicker) return [];
    const pool = this.modelPicker.scope === "scoped"
      ? this.modelPicker.options.filter((option) => option.active)
      : this.modelPicker.options;
    const q = this.modelPicker.query.toLowerCase();
    if (!q) return pool;
    return pool.filter(o =>
      o.modelId.toLowerCase().includes(q) || o.providerName.toLowerCase().includes(q)
    );
  }

  private toggleModelScope(): void {
    if (!this.modelPicker) return;
    this.modelPicker.scope = this.modelPicker.scope === "all" ? "scoped" : "all";
    this.modelPicker.cursor = this.clampMenuCursor(this.modelPicker.cursor, this.getFilteredModels().length);
    this.draw();
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

  private previewCurrentItem(): void {
    if (!this.itemPicker?.onPreview) return;
    const item = this.getFilteredItems()[this.itemPicker.cursor];
    if (!item) return;
    this.itemPicker.onPreview(item.id);
  }

  private closeItemPicker(revertPreview = false): void {
    if (revertPreview) this.itemPicker?.onCancel?.();
    this.itemPicker = null;
    this.drawNow();
  }

  private getSidebarMaxScroll(visibleHeight: number): number {
    const sidebarLines = this.buildSidebarLines();
    return Math.max(0, sidebarLines.length - visibleHeight);
  }

  private clampMenuCursor(cursor: number, itemCount: number): number {
    if (itemCount <= 0) return 0;
    return Math.max(0, Math.min(itemCount - 1, cursor));
  }

  private buildMenuView(entries: MenuEntry[], cursor: number, maxVisible: number): MenuEntry[] {
    if (entries.length <= maxVisible) return entries;
    let cursorEntryIndex = entries.findIndex((entry) => entry.selectIndex === cursor);
    if (cursorEntryIndex < 0) cursorEntryIndex = entries.findIndex((entry) => entry.selectIndex !== undefined);
    if (cursorEntryIndex < 0) cursorEntryIndex = 0;
    let start = Math.max(0, cursorEntryIndex - Math.floor(maxVisible / 2));
    if (start + maxVisible > entries.length) start = Math.max(0, entries.length - maxVisible);
    return entries.slice(start, start + maxVisible);
  }

  private registerMenuClickTarget(targets: Array<{ lineIndex: number; action: () => void }>, lines: string[], action: () => void): void {
    targets.push({ lineIndex: lines.length, action });
  }

  private getQuestionOptionEntries(): MenuEntry[] {
    if (!this.questionPrompt?.options) return [];
    return this.questionPrompt.options.map((option, i) => {
      const isCursor = i === this.questionPrompt!.cursor;
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const color = isCursor ? `${TXT()}${BOLD}` : DIM;
      return { text: ` ${arrow}${color}${option}${RESET}`, selectIndex: i };
    });
  }

  private getFilePickerEntries(): MenuEntry[] {
    if (!this.filePicker) return [];
    return this.filePicker.filtered.map((file, i) => {
      const isCursor = i === this.filePicker!.cursor;
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const color = isCursor ? `${TXT()}${BOLD}` : DIM;
      return { text: ` ${arrow}${color}${file}${RESET}`, selectIndex: i };
    });
  }

  private getSettingsPickerEntries(): MenuEntry[] {
    if (!this.settingsPicker) return [];
    const filtered = this.getFilteredSettings();
    return filtered.map((entry, i) => {
      const isCursor = i === this.settingsPicker!.cursor;
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const nameCol = isCursor ? `${TXT()}${BOLD}` : T();
      const pad = " ".repeat(Math.max(1, 22 - entry.label.length));
      const valColor = entry.value === "true" ? T() : DIM;
      return {
        text: ` ${arrow}${nameCol}${entry.label}${RESET}${pad}${valColor}${entry.value}${RESET}`,
        selectIndex: i,
      };
    });
  }

  private getItemPickerEntries(): MenuEntry[] {
    if (!this.itemPicker) return [];
    const filtered = this.getFilteredItems();
    return filtered.map((item, i) => {
      const isCursor = i === this.itemPicker!.cursor;
      const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
      const labelCol = isCursor ? `${TXT()}${BOLD}` : T();
      return {
        text: ` ${arrow}${labelCol}${item.label}${RESET}${item.detail ? ` ${DIM}${item.detail}${RESET}` : ""}`,
        selectIndex: i,
      };
    });
  }

  private getModelPickerEntries(): MenuEntry[] {
    if (!this.modelPicker) return [];
    const filtered = this.getFilteredModels();
    const byProvider = new Map<string, ModelOption[]>();
    for (const opt of filtered) {
      if (!byProvider.has(opt.providerName)) byProvider.set(opt.providerName, []);
      byProvider.get(opt.providerName)!.push(opt);
    }

    const entries: MenuEntry[] = [];
    let currentIdx = 0;
    for (const [provider, opts] of byProvider) {
      entries.push({ text: ` ${DIM}${provider}${RESET}` });
      for (const opt of opts) {
        const isCursor = currentIdx === this.modelPicker.cursor;
        const pin = opt.active ? ` ${T()}*${RESET}` : "";
        const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
        const nameCol = isCursor ? `${TXT()}${BOLD}` : T();
        entries.push({
          text: `  ${arrow}${nameCol}${opt.modelId}${RESET}${pin}`,
          selectIndex: currentIdx,
        });
        currentIdx++;
      }
    }
    return entries;
  }

  private getCommandSuggestionEntries(): MenuEntry[] {
    const matches = this.getCommandMatches();
    if (matches.length === 0) return [];
    const cursor = Math.min(this.cmdSuggestionCursor, matches.length - 1);
    return matches.map((entry, i) => {
      const arrow = i === cursor ? `${T()}> ${RESET}` : "  ";
      const nameColor = i === cursor ? `${TXT()}${BOLD}` : T();
      const pad = " ".repeat(Math.max(1, 16 - entry.name.length));
      return {
        text: ` ${arrow}${nameColor}${entry.name}${RESET}${pad}${DIM}${entry.desc}${RESET}`,
        selectIndex: i,
      };
    });
  }

  private scrollSidebar(delta: number, visibleHeight: number): void {
    const maxScroll = this.getSidebarMaxScroll(visibleHeight);
    this.sidebarScrollOffset = Math.max(0, Math.min(maxScroll, this.sidebarScrollOffset + delta));
  }

  private scrollActiveMenu(delta: number): boolean {
    if (this.questionPrompt?.options) {
      this.questionPrompt.cursor = this.clampMenuCursor(this.questionPrompt.cursor + delta, this.questionPrompt.options.length);
      return true;
    }
    if (this.settingsPicker) {
      this.settingsPicker.cursor = this.clampMenuCursor(this.settingsPicker.cursor + delta, this.getFilteredSettings().length);
      return true;
    }
    if (this.itemPicker) {
      this.itemPicker.cursor = this.clampMenuCursor(this.itemPicker.cursor + delta, this.getFilteredItems().length);
      this.previewCurrentItem();
      return true;
    }
    if (this.modelPicker) {
      this.modelPicker.cursor = this.clampMenuCursor(this.modelPicker.cursor + delta, this.getFilteredModels().length);
      return true;
    }
    if (this.filePicker) {
      this.filePicker.cursor = this.clampMenuCursor(this.filePicker.cursor + delta, this.filePicker.filtered.length);
      return true;
    }
    const suggestions = this.getCommandMatches();
    if (suggestions.length > 0) {
      this.cmdSuggestionCursor = this.clampMenuCursor(this.cmdSuggestionCursor + delta, suggestions.length);
      return true;
    }
    return false;
  }

  private selectQuestionOption(index: number): void {
    if (!this.questionPrompt?.options) return;
    const answer = this.questionPrompt.options[index];
    if (!answer) return;
    const qp = this.questionPrompt;
    qp.cursor = index;
    this.questionPrompt = null;
    this.addMessage("system", `${DIM}> ${answer}${RESET}`);
    this.invalidateMsgCache();
    this.drawNow();
    qp.resolve(answer);
  }

  private toggleSettingEntry(index: number): void {
    if (!this.settingsPicker) return;
    const filtered = this.getFilteredSettings();
    const entry = filtered[index];
    if (!entry) return;
    this.settingsPicker.cursor = index;
    if (this.onSettingToggle) this.onSettingToggle(entry.key);
    this.draw();
  }

  private selectItemEntry(index: number): void {
    if (!this.itemPicker) return;
    const filtered = this.getFilteredItems();
    const item = filtered[index];
    if (!item) return;
    this.itemPicker.cursor = index;
    if (this.onItemSelect) this.onItemSelect(item.id);
    this.closeItemPicker(false);
  }

  private toggleModelPin(index: number): void {
    if (!this.modelPicker) return;
    const filtered = this.getFilteredModels();
    const opt = filtered[index];
    if (!opt) return;
    this.modelPicker.cursor = index;
    opt.active = !opt.active;
    if (this.onModelPin) this.onModelPin(opt.providerId, opt.modelId, opt.active);
    this.draw();
  }

  private selectModelEntry(index: number): void {
    if (!this.modelPicker) return;
    const filtered = this.getFilteredModels();
    const selected = filtered[index];
    if (!selected) return;
    this.modelPicker.cursor = index;
    this.modelPicker = null;
    if (this.onModelSelect) {
      this.onModelSelect(selected.providerId, selected.modelId);
    }
    this.drawNow();
  }

  private selectFileEntry(index: number): void {
    if (!this.filePicker) return;
    const selected = this.filePicker.filtered[index];
    if (!selected) return;
    this.filePicker.cursor = index;
    const text = this.input.getText();
    const atIdx = text.lastIndexOf("@");
    if (atIdx >= 0) {
      this.input.clear();
      this.input.paste(text.slice(0, atIdx) + `@${selected} `);
    }
    const content = readFileForContext(this.cwd, selected);
    this.fileContexts.set(selected, content);
    this.filePicker = null;
    this.drawNow();
  }

  private applyCommandSuggestion(index: number, submitOnReturn = false): void {
    const suggestions = this.getCommandMatches();
    const selected = suggestions[index];
    if (!selected) return;
    this.cmdSuggestionCursor = index;
    this.input.clear();
    this.input.paste(`/${selected.name}`);
    if (submitOnReturn) {
      const cmd = this.input.submit();
      if (cmd && this.onSubmit) this.onSubmit(cmd);
    }
    this.draw();
  }

  private hideCursorBriefly(durationMs = 140): void {
    this.hideCursorUntil = Date.now() + durationMs;
    if (this.hideCursorTimer) clearTimeout(this.hideCursorTimer);
    this.hideCursorTimer = setTimeout(() => {
      this.hideCursorTimer = null;
      this.draw();
    }, durationMs + 10);
  }

  private getSidebarBorder(): string {
    return `${currentTheme().sidebarBorder}│${RESET}`;
  }

  private shouldEnableMenuMouse(): boolean {
    return Boolean(
      this.shouldShowSidebar() ||
      this.questionPrompt?.options ||
      this.filePicker ||
      this.itemPicker ||
      this.settingsPicker ||
      this.modelPicker ||
      this.getCommandMatches().length > 0
    );
  }

  private handleKey(key: Keypress): void {
    // Block input during compacting (only allow Ctrl+C to exit)
    if (this.isCompacting) {
      if (key.ctrl && key.name === "c") {
        this.ctrlCCount++;
        if (this.ctrlCCount >= 2) { this.stop(); return; }
        this.primeCtrlCExit();
      }
      return;
    }

    // Mouse click — sidebar first, then active bottom menus
    if (key.name === "click" && key.char) {
      const [colStr, rowStr] = key.char.split(",");
      const col = parseInt(colStr, 10);
      const row = parseInt(rowStr, 10);
      const hasSB = this.shouldShowSidebar();
      if (hasSB && col > this.screen.mainWidth) {
        this.sidebarFocused = true;
        const sidebarLines = this.renderSidebar(this.getChatHeight());
        const clickedLine = row <= sidebarLines.length ? sidebarLines[row - 1] : undefined;
        if (clickedLine) {
          const plain = stripAnsi(clickedLine).trim();
          if (plain.startsWith("▾ Files") || plain.startsWith("▸ Files")) {
            this.sidebarTreeOpen = !this.sidebarTreeOpen;
          } else if (plain.match(/^[▾▸] .+\/$/)) {
            const dirName = plain.slice(2).replace(/\/$/, "");
            if (this.sidebarExpandedDirs.has(dirName)) {
              this.sidebarExpandedDirs.delete(dirName);
            } else {
              this.sidebarExpandedDirs.add(dirName);
            }
          } else if (plain.match(/^▸ \+\d+ more$/)) {
            for (let i = row - 2; i >= 0; i--) {
              const prevPlain = stripAnsi(sidebarLines[i] ?? "").trim();
              if (prevPlain.match(/^▾ .+\/$/)) {
                const dirName = prevPlain.slice(2).replace(/\/$/, "");
                this.sidebarExpandedDirs.add(`${dirName}:all`);
                break;
              }
            }
          }
        }
        this.draw();
      } else {
        this.sidebarFocused = false;
        const menuAction = this.activeMenuClickTargets.get(row);
        if (menuAction) {
          menuAction();
        }
      }
      return;
    }

    // Mouse wheel: menus/sidebar only, never transcript history
    if (key.name === "scrollup") {
      this.hideCursorBriefly();
      if (this.sidebarFocused && this.screen.hasSidebar && !getSettings().hideSidebar) {
        this.scrollSidebar(-3, this.getChatHeight());
        this.draw();
      } else if (this.scrollActiveMenu(-1)) {
        this.draw();
      }
      return;
    }
    if (key.name === "scrolldown") {
      this.hideCursorBriefly();
      if (this.sidebarFocused && this.screen.hasSidebar && !getSettings().hideSidebar) {
        this.scrollSidebar(3, this.getChatHeight());
        this.draw();
      } else if (this.scrollActiveMenu(1)) {
        this.draw();
      }
      return;
    }

    // Keyboard transcript paging only
    if (key.name === "pageup" || (key.ctrl && key.name === "up")) {
      this.hideCursorBriefly();
      this.scrollOffset = Math.max(0, this.scrollOffset - 3);
      this.invalidateMsgCache();
      this.draw();
      return;
    }
    if (key.name === "pagedown" || (key.ctrl && key.name === "down")) {
      this.hideCursorBriefly();
      const chatHeight = this.getChatHeight();
      const messageLines = this.renderMessages(this.screen.mainWidth - 2);
      const maxScroll = Math.max(0, messageLines.length - chatHeight);
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 3);
      this.invalidateMsgCache();
      this.draw();
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
          this.selectQuestionOption(qp.cursor);
        } else if (key.name === "escape") {
          this.questionPrompt = null;
          this.addMessage("system", `${DIM}> [skipped]${RESET}`);
          this.invalidateMsgCache();
          this.drawNow();
          qp.resolve("[user skipped]");
        }
      } else {
        // Free text input
        if (key.name === "return") {
          const answer = qp.textInput.trim() || "[no answer]";
          this.questionPrompt = null;
          this.addMessage("system", `${DIM}> ${answer}${RESET}`);
          this.invalidateMsgCache();
          this.drawNow();
          qp.resolve(answer);
        } else if (key.name === "escape") {
          this.questionPrompt = null;
          this.addMessage("system", `${DIM}> [skipped]${RESET}`);
          this.invalidateMsgCache();
          this.drawNow();
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
        this.toggleSettingEntry(this.settingsPicker.cursor);
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.settingsPicker = null;
        this.drawNow();
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
        this.previewCurrentItem();
        this.draw();
      } else if (key.name === "down") {
        this.itemPicker.cursor = Math.min(filtered.length - 1, this.itemPicker.cursor + 1);
        this.previewCurrentItem();
        this.draw();
      } else if (key.name === "return") {
        this.selectItemEntry(this.itemPicker.cursor);
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.closeItemPicker(true);
      } else if (key.name === "tab") {
        const item = filtered[this.itemPicker.cursor];
        if (item && this.itemPicker.onSecondaryAction) {
          this.itemPicker.onSecondaryAction(item.id);
        }
      } else if (key.name === "backspace") {
        if (this.itemPicker.query.length > 0) {
          this.itemPicker.query = this.itemPicker.query.slice(0, -1);
          this.itemPicker.cursor = 0;
          this.previewCurrentItem();
          this.draw();
        }
      } else if (key.char && !key.ctrl && !key.meta && key.char.length === 1) {
        this.itemPicker.query += key.char;
        this.itemPicker.cursor = 0;
        this.previewCurrentItem();
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
        this.toggleModelScope();
      } else if (key.name === "space") {
        this.toggleModelPin(this.modelPicker.cursor);
      } else if (key.name === "return") {
        this.selectModelEntry(this.modelPicker.cursor);
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.modelPicker = null;
        this.drawNow();
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
        this.selectFileEntry(this.filePicker.cursor);
      } else if (key.name === "escape") {
        this.filePicker = null;
        this.drawNow();
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
          this.drawNow();
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

    // ESC to interrupt streaming (double press)
    if (key.name === "escape" && this.isStreaming && this.onAbort) {
      if (this.escPrimed) {
        this.clearInterruptPrompt();
        this.onAbort();
      } else {
        this.primeEscapeAbort();
      }
      return;
    }

    if (key.ctrl && key.name === "c") {
      this.ctrlCCount++;
      if (this.ctrlCCount >= 2) { this.stop(); return; }
      this.primeCtrlCExit();
      return;
    }
    this.clearInterruptPrompt();

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

    // Shift+Tab — toggle between build and plan mode
    if (key.shift && key.name === "tab") {
      this.mode = this.mode === "build" ? "plan" : "build";
      if (this.onModeChange) this.onModeChange(this.mode);
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
          this.applyCommandSuggestion(this.cmdSuggestionCursor, key.name === "return");
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
        const shouldQueueBtw = this.isStreaming && text.startsWith("/btw");
        
        // If not streaming, always submit immediately
        // If streaming, check followUpMode
        if (!this.isStreaming) {
          // Not streaming - submit immediately
          if (images.length > 0) {
            (this.onSubmit as (text: string, images?: Array<{ mimeType: string; data: string }>) => void)(text, images);
          } else {
            this.onSubmit(text);
          }
        } else if (followUpMode === "immediate" && !shouldQueueBtw) {
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
        filtered: this.projectFiles,
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
            const tag = `${currentTheme().imageTagBg}${BOLD}${TXT()}[IMAGE ${i + 1}]${RESET}`;
            content += ` ${tag}`;
          }
        }
        const availW = Math.max(1, maxWidth - 4);
        const contentLines = content.split("\n");
        lines.push(`${USER_BG()}${" ".repeat(maxWidth)}${RESET}`);
        for (let li = 0; li < contentLines.length; li++) {
          const wrapped = wordWrap(contentLines[li], availW);
          for (let wi = 0; wi < wrapped.length; wi++) {
            const text = wrapped[wi];
            const padW = Math.max(0, maxWidth - text.length - 4);
            lines.push(`${USER_BG()}${USER_TXT()}  ${text}${" ".repeat(padW)}  ${RESET}`);
          }
        }
        lines.push(`${USER_BG()}${" ".repeat(maxWidth)}${RESET}`);
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
          lines.push(`${BORDER()}  ${"─".repeat(Math.max(1, maxWidth - 4))}${RESET}`);
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
          lines.push(`${MUTED()}  ${plain}${RESET}`);
        } else {
          for (let i = 0; i < plain.length; i += wrapW) {
            lines.push(`${MUTED()}  ${plain.slice(i, i + wrapW)}${RESET}`);
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
    const icon = tc.error ? `${ERR()}\u25CF${RESET}`
      : done ? `${DIM}\u25CF${RESET}`
      : (this.spinnerFrame % 2 === 0 ? `${OK()}\u25CF${RESET}` : `${ACCENT_2()}\u25CF${RESET}`);

    const desc = this.toolDescription(tc);
    lines.push(`  ${icon} ${done ? MUTED() : TXT()}${desc}${running ? "..." : ""}${RESET}`);

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
          lines.push(`  ${currentTheme().diffRemoveBg} ${text}${" ".repeat(pad)} ${RESET}`);
        }
        if (oldLines.length > 4) lines.push(`${DIM}      ... +${oldLines.length - 4} more${RESET}`);
        // Show added lines (green bg)
        for (const l of newLines.slice(0, 4)) {
          const text = `+ ${l}`.slice(0, diffW - 2);
          const pad = Math.max(0, diffW - 2 - text.length);
          lines.push(`  ${currentTheme().diffAddBg} ${text}${" ".repeat(pad)} ${RESET}`);
        }
        if (newLines.length > 4) lines.push(`${DIM}      ... +${newLines.length - 4} more${RESET}`);
      } else if (tc.name === "writeFile" && a?.content) {
        const newLines = a.content.split("\n");
        const diffW = maxWidth - 6;
        lines.push(`${DIM}  ${L} ${newLines.length} lines written${RESET}`);
        for (const l of newLines.slice(0, 6)) {
          const text = `+ ${l}`.slice(0, diffW - 2);
          const pad = Math.max(0, diffW - 2 - text.length);
          lines.push(`  ${currentTheme().diffAddBg} ${text}${" ".repeat(pad)} ${RESET}`);
        }
        if (newLines.length > 6) {
          lines.push(`${DIM}      ... +${newLines.length - 6} more${RESET}`);
        }
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
      lines.push(`${ERR()}  ${L} ${tc.result}${RESET}`);
    }

    return lines;
  }

  /** Render messages + dynamic overlays (tool calls, thinking, loading) */
  private renderMessages(maxWidth: number): string[] {
    const lines = [...this.renderStaticMessages(maxWidth)];

    // Thinking block — show reasoning as it streams in
    if (this.thinkingBuffer) {
      const thinkLines = this.thinkingBuffer.split("\n").slice(-8);
      lines.push(`  ${T()}${this.isStreaming ? "thinking" : "thought"}${RESET}`);
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
        lines.push(`  ${allDone ? OK() : T()}\u2714${RESET} ${DIM}Tasks ${done}/${total}${RESET}`);
      }
      // Task items
      for (let i = 0; i < this.todoItems.length; i++) {
        const item = this.todoItems[i];
        const isLast = i === this.todoItems.length - 1;
        const branch = isLast ? "\u2514" : "\u251C"; // └ or ├
        const icon = item.status === "done" ? `${OK()}\u25A0${RESET}` // ■ green
          : item.status === "in_progress" ? `${T()}${spin}${RESET}` // spinner
          : `${DIM}\u25A1${RESET}`; // □ dim
        const textColor = item.status === "done" ? DIM : item.status === "in_progress" ? `${TXT()}${BOLD}` : DIM;
        lines.push(`  ${DIM}${branch}${RESET} ${icon} ${textColor}${item.text.slice(0, maxWidth - 10)}${RESET}`);
      }
      lines.push("");
    }

    // Compacting indicator
    if (this.isCompacting) {
      const elapsed = Date.now() - this.compactStartTime;
      const secs = Math.floor(elapsed / 1000);
      const mins = Math.floor(secs / 60);
      const timeStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
      const tokenStr = this.compactTokens > 0 ? ` \u2191 ${fmtTokens(this.compactTokens)} tokens` : "";
      const sparkle = this.sparkleSpinner(this.spinnerFrame, WARN());
      const shimmer = this.shimmerText("Compacting conversation...", this.spinnerFrame);
      lines.push(`  ${sparkle} ${shimmer} ${DIM}(${timeStr}${tokenStr ? ` \u00B7${tokenStr}` : ""})${RESET}`);
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
    const git = this.gitBranch ? ` ${MUTED()}${this.gitBranch}${this.gitDirty ? "*" : ""}${RESET}` : "";
    return ` ${model}${git}`;
  }

  private shouldShowSidebar(): boolean {
    return this.messages.length > 0 && this.screen.hasSidebar && !getSettings().hideSidebar;
  }

  private pickHomeTipIndex(): number {
    const seed = `${process.cwd()}|${process.platform}|${this.appVersion}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    return hash % HOME_TIPS.length;
  }

  private refreshHomeScreenData(): void {
    this.homeRecentSessions = Session.listRecent(5);
    this.homeTip = HOME_TIPS[this.pickHomeTipIndex()];
  }

  private formatShortCwd(maxWidth: number): string {
    return this.formatShortPath(this.cwd, maxWidth);
  }

  private formatShortPath(pathValue: string, maxWidth: number): string {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    let display = pathValue;
    if (home && display.toLowerCase().startsWith(home.toLowerCase())) {
      display = `~${display.slice(home.length)}`;
      if (display === "~") display = "~/";
    }
    if (maxWidth <= 1) return display.slice(0, Math.max(0, maxWidth));
    if (display.length <= maxWidth) return display;
    return `~${display.slice(-(maxWidth - 1))}`;
  }

  private formatRelativeAge(updatedAt: number): string {
    const diffMs = Math.max(0, Date.now() - updatedAt);
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  private resolveMascotPath(): string | null {
    const svgCandidates = [
      join(process.cwd(), "logos", "brokecli-face.svg"),
      join(APP_DIR, "..", "..", "logos", "brokecli-face.svg"),
      join(process.cwd(), "logos", "brokecli-square.svg"),
      join(APP_DIR, "..", "..", "logos", "brokecli-square.svg"),
    ];
    return svgCandidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  private resolveInlineMascotPath(): string | null {
    const svgCandidates = [
      join(process.cwd(), "logos", "brokecli-face-2x.svg"),
      join(APP_DIR, "..", "..", "logos", "brokecli-face-2x.svg"),
    ];
    return svgCandidates.find((candidate) => existsSync(candidate)) ?? this.resolveMascotPath();
  }

  private parseSvgColor(fill: string | undefined, opacity: string | undefined): RgbColor | null {
    if (!fill || fill === "none") return null;
    const match = fill.match(/^#([0-9a-f]{6})$/i);
    if (!match) return null;
    const alpha = opacity ? Math.max(0, Math.min(1, Number(opacity))) : 1;
    if (alpha <= 0) return null;
    return {
      r: parseInt(match[1].slice(0, 2), 16),
      g: parseInt(match[1].slice(2, 4), 16),
      b: parseInt(match[1].slice(4, 6), 16),
      a: alpha,
    };
  }

  private renderAnsiColorGrid(grid: Array<Array<RgbColor | null>>): string[] {
    const lines: string[] = [];
    const fg = (color: RgbColor): string => `\x1b[38;2;${color.r};${color.g};${color.b}m`;
    const bg = (color: RgbColor): string => `\x1b[48;2;${color.r};${color.g};${color.b}m`;
    for (let row = 0; row < grid.length; row += 2) {
      let line = "";
      for (let col = 0; col < (grid[row]?.length ?? 0); col++) {
        const top = grid[row][col];
        const bottom = grid[row + 1]?.[col] ?? null;
        if (top && bottom) {
          if (top.r === bottom.r && top.g === bottom.g && top.b === bottom.b) {
            line += `${bg(top)} ${RESET}`;
          } else {
            line += `${fg(top)}${bg(bottom)}▀${RESET}`;
          }
        } else if (top) {
          line += `${fg(top)}▀${RESET}`;
        } else if (bottom) {
          line += `${fg(bottom)}▄${RESET}`;
        } else {
          line += " ";
        }
      }
      lines.push(line);
    }
    return lines;
  }

  private parseMascotSvgGrid(path: string): Array<Array<RgbColor | null>> {
    try {
      const svg = readFileSync(path, "utf-8");
      const viewBoxMatch = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/i);
      const widthAttrMatch = svg.match(/\bwidth="(\d+(?:\.\d+)?)"/i);
      const heightAttrMatch = svg.match(/\bheight="(\d+(?:\.\d+)?)"/i);
      const spriteWidth = Math.max(1, Math.round(Number(viewBoxMatch?.[1] ?? widthAttrMatch?.[1] ?? "20")));
      const spriteHeight = Math.max(1, Math.round(Number(viewBoxMatch?.[2] ?? heightAttrMatch?.[1] ?? "20")));
      const cells: Array<Array<RgbColor | null>> = Array.from(
        { length: spriteHeight },
        () => Array.from({ length: spriteWidth }, () => null),
      );
      const rects = [...svg.matchAll(/<rect\s+([^>]+?)\s*\/?>/g)];
      for (const rect of rects) {
        const attrs = Object.fromEntries(
          [...rect[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
        ) as Record<string, string>;
        const color = this.parseSvgColor(attrs.fill, attrs.opacity);
        if (!color) continue;
        const x = Number(attrs.x ?? "0");
        const y = Number(attrs.y ?? "0");
        const width = Number(attrs.width ?? "0");
        const height = Number(attrs.height ?? "0");
        for (let row = y; row < y + height; row++) {
          for (let col = x; col < x + width; col++) {
            if (row >= 0 && row < spriteHeight && col >= 0 && col < spriteWidth) cells[row][col] = color;
          }
        }
      }
      return cells;
    } catch {
      return [];
    }
  }

  private scaleColorGrid(
    cells: Array<Array<RgbColor | null>>,
    targetWidth: number,
    targetHeight: number,
  ): Array<Array<RgbColor | null>> {
    const srcHeight = cells.length;
    const srcWidth = cells[0]?.length ?? 0;
    if (srcHeight === 0 || srcWidth === 0) return [];
    return Array.from({ length: targetHeight }, (_, row) =>
      Array.from({ length: targetWidth }, (_, col) => {
        const srcRow = Math.min(srcHeight - 1, Math.floor((row / targetHeight) * srcHeight));
        const srcCol = Math.min(srcWidth - 1, Math.floor((col / targetWidth) * srcWidth));
        return cells[srcRow]?.[srcCol] ?? null;
      }),
    );
  }

  private resampleColorGrid(
    cells: Array<Array<RgbColor | null>>,
    targetWidth: number,
    targetHeight: number,
  ): Array<Array<RgbColor | null>> {
    const srcHeight = cells.length;
    const srcWidth = cells[0]?.length ?? 0;
    if (srcHeight === 0 || srcWidth === 0) return [];
    const background = cells[0]?.[0] ?? null;
    const backgroundKey = background ? `${background.r},${background.g},${background.b}` : null;

    return Array.from({ length: targetHeight }, (_, row) =>
      Array.from({ length: targetWidth }, (_, col) => {
        const startRow = Math.floor((row * srcHeight) / targetHeight);
        const endRow = Math.max(startRow + 1, Math.floor(((row + 1) * srcHeight) / targetHeight));
        const startCol = Math.floor((col * srcWidth) / targetWidth);
        const endCol = Math.max(startCol + 1, Math.floor(((col + 1) * srcWidth) / targetWidth));
        const counts = new Map<string, { color: RgbColor; count: number }>();

        for (let y = startRow; y < endRow; y++) {
          for (let x = startCol; x < endCol; x++) {
            const color = cells[y]?.[x] ?? null;
            if (!color) continue;
            const key = `${color.r},${color.g},${color.b}`;
            const existing = counts.get(key);
            if (existing) existing.count += 1;
            else counts.set(key, { color, count: 1 });
          }
        }

        if (counts.size === 0) return null;
        const ranked = [...counts.entries()].sort((a, b) => {
          const aBoost = a[0] === backgroundKey ? 0 : 1000;
          const bBoost = b[0] === backgroundKey ? 0 : 1000;
          return (b[1].count + bBoost) - (a[1].count + aBoost);
        });
        return ranked[0][1].color;
      }),
    );
  }

  private renderMascotBlock(): string[] {
    const path = this.resolveMascotPath();
    if (!path) return [];
    const cells = this.parseMascotSvgGrid(path);
    return this.renderAnsiColorGrid(cells);
  }

  private renderMascotInline(): string[] {
    const path = this.resolveInlineMascotPath();
    if (!path) return [];
    const cells = this.parseMascotSvgGrid(path);
    const compact = this.resampleColorGrid(cells, 12, 6);
    return this.renderAnsiColorGrid(compact);
  }

  private wrapHomeDetail(label: string, value: string, width: number): string[] {
    const prefix = `${TXT()}${label}${RESET}  `;
    const prefixPlain = `${label}  `;
    const available = Math.max(8, width - prefixPlain.length);
    const wrapped = wordWrap(value, available);
    return wrapped.map((part, index) => index === 0 ? `${prefix}${MUTED()}${part}${RESET}` : `${" ".repeat(prefixPlain.length)}${MUTED()}${part}${RESET}`);
  }

  private wrapHomeText(prefix: string, prefixPlain: string, value: string, width: number, color = MUTED()): string[] {
    const available = Math.max(6, width - prefixPlain.length);
    const wrapped = wordWrap(value, available);
    return wrapped.map((part, index) =>
      index === 0
        ? `${prefix}${color}${part}${RESET}`
        : `${" ".repeat(prefixPlain.length)}${color}${part}${RESET}`,
    );
  }

  private centerVisibleLine(line: string, width: number): string {
    const visible = stripAnsi(line).length;
    if (visible >= width) return line;
    const left = Math.floor((width - visible) / 2);
    return `${" ".repeat(left)}${line}`;
  }

  private renderHomeBox(width: number, title: string, body: string[]): string[] {
    const innerWidth = Math.max(1, width - 2);
    const titleText = title ? ` ${title} ` : "";
    const titleFill = Math.max(0, innerWidth - stripAnsi(titleText).length);
    const lines = [`${BORDER()}${BOX.tl}${titleText}${BOX.h.repeat(titleFill)}${BOX.tr}${RESET}`];
    for (const row of body) {
      lines.push(`${BORDER()}${BOX.v}${RESET}${this.padLine(row, innerWidth)}${BORDER()}${BOX.v}${RESET}`);
    }
    lines.push(`${BORDER()}${BOX.bl}${BOX.h.repeat(innerWidth)}${BOX.br}${RESET}`);
    return lines;
  }

  private renderHomeView(mainW: number, topHeight: number): string[] {
    const mascotInline = this.renderMascotInline();
    const modelLabel = this.modelName === "none"
      ? "Pick one with /model"
      : `${this.providerName}/${this.modelName}`;
    const versionText = `v${this.appVersion}`;
    const boxWidth = Math.max(12, mainW - 4);
    const innerWidth = Math.max(1, boxWidth - 2);
    const contentWidth = Math.max(8, innerWidth - 2);
    const mascotWidth = stripAnsi(mascotInline[0] ?? "").length;
    const textOffset = mascotWidth > 0 ? `${" ".repeat(mascotWidth)} ` : "";
    const headerCandidates = ["Welcome to BrokeCLI", "Welcome"];
    const headerText = headerCandidates.find((candidate) =>
      mascotWidth + (mascotInline.length > 0 ? 1 : 0) + candidate.length <= contentWidth,
    ) ?? headerCandidates[headerCandidates.length - 1];
    const locationBase = this.formatShortCwd(Math.max(10, contentWidth - 1));
    const locationWithVersion = `${locationBase}  ${versionText}`;
    const locationText = locationWithVersion.length <= contentWidth ? locationWithVersion : locationBase;
    const titleLines = this.wrapHomeText(`${T()}${BOLD}`, "", headerText, Math.max(6, contentWidth - textOffset.length), "");
    const locationLines = this.wrapHomeText(`${MUTED()}`, "", locationText, Math.max(6, contentWidth - textOffset.length), "");
    const heroText = [...titleLines, ...locationLines];
    const heroHeight = Math.max(mascotInline.length, heroText.length);
    const heroLines = Array.from({ length: heroHeight }, (_, index) => {
      const sprite = mascotInline[index] ?? textOffset.trimEnd();
      const text = heroText[index] ?? "";
      return text ? `${sprite} ${text}` : sprite;
    });

    const body = [
      ...heroLines,
      "",
      ...this.wrapHomeDetail("Model", modelLabel, Math.max(18, contentWidth)),
      ...this.wrapHomeDetail("Tip", this.homeTip, Math.max(18, contentWidth)),
    ];

    const boxBodyHeight = Math.max(8, topHeight - 2);
    const clippedBody = body.slice(0, boxBodyHeight);
    const box = this.renderHomeBox(boxWidth, "", clippedBody)
      .map((line) => this.centerVisibleLine(line, mainW));
    const lines = box.slice(0, topHeight);
    while (lines.length < topHeight) lines.push("");
    return lines;
  }

  /** Build the full sidebar content before viewport slicing */
  private buildSidebarLines(): string[] {
    const w = this.screen.sidebarWidth;
    const lines: string[] = [];

    // Session name + version
    lines.push(`${TXT()}${BOLD}${this.sessionName.slice(0, w - 2)}${RESET}`);
    lines.push(`${MUTED()}v${this.appVersion}${RESET}`);
    lines.push("");

    // Model
    lines.push(`${T()}${this.providerName}/${this.modelName}${RESET}`);
    lines.push("");

    // Providers
    if (this.detectedProviders.length > 0) {
      lines.push(`${TXT()}Providers${RESET}`);
      for (const p of this.detectedProviders.slice(0, 4)) {
        lines.push(`  ${MUTED()}${p}${RESET}`);
      }
      if (this.detectedProviders.length > 4) {
        lines.push(`  ${MUTED()}+${this.detectedProviders.length - 4} more${RESET}`);
      }
      lines.push("");
    }

    // MCP connections
    if (this.mcpConnections.length > 0) {
      lines.push(`${TXT()}MCP${RESET}`);
      for (const c of this.mcpConnections.slice(0, 3)) {
        lines.push(`  ${currentTheme().success}\u25CF${RESET} ${MUTED()}${c.slice(0, w - 6)}${RESET}`);
      }
      lines.push("");
    }

    // Directory
    lines.push(`${TXT()}Directory${RESET}`);
    const shortCwd = this.formatShortCwd(Math.max(4, w - 2));
    lines.push(`  ${MUTED()}${shortCwd}${RESET}`);
    if (this.gitBranch) {
      lines.push(`  ${MUTED()}${this.gitBranch}${this.gitDirty ? " *" : ""}${RESET}`);
    }
    lines.push("");

    // File tree (collapsible)
    const treeArrow = this.sidebarTreeOpen ? "▾" : "▸";
    lines.push(`${TXT()}${treeArrow} Files${RESET}`);
    if (this.sidebarTreeOpen) {
      if (!this.sidebarFileTree) {
        this.sidebarFileTree = loadSidebarFileTree(this.cwd);
      }
      const tree = this.sidebarFileTree ?? [];
      for (const item of tree) {
        if (item.isDir) {
          const expanded = this.sidebarExpandedDirs.has(item.name);
          const arrow = expanded ? "▾" : "▸";
          const display = item.name.length > w - 6 ? item.name.slice(-(w - 7)) : item.name;
          lines.push(`  ${T()}${arrow} ${display}/${RESET}`);
          if (expanded && item.children) {
            const showCount = this.sidebarExpandedDirs.has(`${item.name}:all`) ? item.children.length : Math.min(item.children.length, 4);
            for (let i = 0; i < showCount; i++) {
              const child = item.children[i];
              const cDisplay = child.length > w - 8 ? child.slice(-(w - 9)) : child;
              lines.push(`    ${DIM}${cDisplay}${RESET}`);
            }
            if (showCount < item.children.length) {
              const remaining = item.children.length - showCount;
              lines.push(`    ${DIM}▸ +${remaining} more${RESET}`);
            }
          }
        } else {
          const display = item.name.length > w - 4 ? item.name.slice(-(w - 5)) : item.name;
          lines.push(`  ${DIM}${display}${RESET}`);
        }
      }
    }

    return lines;
  }

  /** Render the visible sidebar viewport */
  private renderSidebar(visibleHeight: number): string[] {
    const allLines = this.buildSidebarLines();
    const maxScroll = Math.max(0, allLines.length - visibleHeight);
    if (this.sidebarScrollOffset > maxScroll) this.sidebarScrollOffset = maxScroll;
    if (this.sidebarScrollOffset < 0) this.sidebarScrollOffset = 0;

    if (allLines.length <= visibleHeight) return allLines;

    const visible = allLines.slice(this.sidebarScrollOffset, this.sidebarScrollOffset + visibleHeight);
    if (visible.length === 0) return visible;

    if (this.sidebarScrollOffset > 0) {
      visible[0] = `${DIM}^ more${this.sidebarFocused ? " · scroll" : ""}${RESET}`;
    }
    if (this.sidebarScrollOffset + visibleHeight < allLines.length) {
      visible[visible.length - 1] = `${DIM}v more${this.sidebarFocused ? " · scroll" : ""}${RESET}`;
    }
    return visible;
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

  private drawNow(): void {
    this.drawScheduled = false;
    this.lastDrawTime = 0;
    this.drawImmediate();
  }

  private drawImmediate(): void {
    this.lastDrawTime = Date.now();
    this.keypress.setMouseTracking(this.shouldEnableMenuMouse());
    const { height, width } = this.screen;
    const hasSidebar = this.shouldShowSidebar();
    const mainW = hasSidebar ? this.screen.mainWidth : width;
    const footerLines = hasSidebar ? this.renderSidebarFooter() : [];
    const inputText = this.input.getText();
    const cursor = this.input.getCursor();
    const inputLayout = this.getInputCursorLayout(inputText, cursor, mainW);
    const isHome = this.messages.length === 0;

    // Build bottom section first to know how much space it takes
    const bottomLines: string[] = [];
    const bottomMenuClicks: Array<{ lineIndex: number; action: () => void }> = [];

    // Separator above input
    bottomLines.push(`${DIM}${"─".repeat(mainW)}${RESET}`);

    // Input line(s) — explicit multi-line and soft-wrapped long lines
    for (let i = 0; i < inputLayout.lines.length; i++) {
      bottomLines.push(inputLayout.lines[i]);
    }

    // Question prompt from model
    if (this.questionPrompt) {
      const qp = this.questionPrompt;
      bottomLines.push(`${BORDER()}${"─".repeat(mainW)}${RESET}`);
      bottomLines.push(` ${T()}?${RESET} ${TXT()}${BOLD}${qp.question}${RESET}`);
      if (qp.options) {
        for (const entry of this.buildMenuView(this.getQuestionOptionEntries(), qp.cursor, 8)) {
          if (entry.selectIndex !== undefined) {
            this.registerMenuClickTarget(bottomMenuClicks, bottomLines, () => this.selectQuestionOption(entry.selectIndex!));
          }
          bottomLines.push(entry.text);
        }
        bottomLines.push(` ${DIM}enter select, esc skip${RESET}`);
      } else {
        for (const line of this.getWrappedInputLines(qp.textInput, mainW)) {
          bottomLines.push(`  ${line}`);
        }
        bottomLines.push(` ${DIM}enter submit, esc skip${RESET}`);
      }
    }

    // Pickers appear below input
    if (this.filePicker) {
      bottomLines.push(`${BORDER()}${"─".repeat(mainW)}${RESET}`);
      this.appendFilePicker(bottomLines, height, bottomMenuClicks);
    } else if (this.itemPicker) {
      bottomLines.push(`${BORDER()}${"─".repeat(mainW)}${RESET}`);
      this.appendItemPicker(bottomLines, height, bottomMenuClicks);
    } else if (this.settingsPicker) {
      bottomLines.push(`${BORDER()}${"─".repeat(mainW)}${RESET}`);
      this.appendSettingsPicker(bottomLines, height, bottomMenuClicks);
    } else if (this.modelPicker) {
      bottomLines.push(`${BORDER()}${"─".repeat(mainW)}${RESET}`);
      this.appendModelPicker(bottomLines, height, bottomMenuClicks);
    } else {
      const suggestions = this.buildMenuView(this.getCommandSuggestionEntries(), this.cmdSuggestionCursor, 5);
      if (suggestions.length > 0) {
        bottomLines.push(`${BORDER()}${"─".repeat(mainW)}${RESET}`);
      }
      for (const entry of suggestions) {
        if (entry.selectIndex !== undefined) {
          this.registerMenuClickTarget(bottomMenuClicks, bottomLines, () => this.applyCommandSuggestion(entry.selectIndex!));
        }
        bottomLines.push(entry.text);
      }
      if (suggestions.length > 0) {
        bottomLines.push(` ${DIM}(${Math.min(this.cmdSuggestionCursor + 1, this.getCommandMatches().length)}/${this.getCommandMatches().length})${RESET}`);
      }
    }

    // Separator below input/pickers
    bottomLines.push(`${DIM}${"─".repeat(mainW)}${RESET}`);

    // Info bar below input — contextual status + hints
    {
      const parts: Array<{ text: string; plain: string; priority: number }> = [];
      if (this.ctrlCCount === 1) {
        parts.push({ text: `${ERR()}Ctrl+C again to exit${RESET}`, plain: "Ctrl+C again to exit", priority: -1 });
      } else if (this.escPrimed) {
        parts.push({ text: `${ERR()}Esc again to stop${RESET}`, plain: "Esc again to stop", priority: -1 });
      }
      if (this.isStreaming) {
        parts.push({ text: `${DIM}esc${RESET} ${DIM}stop${RESET}`, plain: "esc stop", priority: 0 });
      }
      const settings = getSettings();
      if (!hasSidebar) {
        const modeLabel = this.mode === "plan" ? "plan" : "build";
        parts.push({ text: `${this.mode === "plan" ? P() : T()}${modeLabel}${RESET}`, plain: modeLabel, priority: 1 });
        if (this.pendingMessages.length > 0) {
          parts.push({ text: `${P()}${this.pendingMessages.length} queued${RESET}`, plain: `${this.pendingMessages.length} queued`, priority: 2 });
        }
        const thinkLevel = settings.thinkingLevel || (settings.enableThinking ? "low" : "off");
        if (thinkLevel !== "off") {
          parts.push({ text: `${T()}${thinkLevel}${RESET}`, plain: thinkLevel, priority: 3 });
        }
        const caveLevel = settings.cavemanLevel ?? "off";
        if (caveLevel !== "off") {
          parts.push({ text: `\u{1FAA8} ${WARN()}${caveLevel}${RESET}`, plain: `rock ${caveLevel}`, priority: 3 });
        }
      }
      // Cost/tokens in bottom bar — compact when there's no sidebar
      const liveTokens = this.getLiveTotalTokens();
      const showCost = settings.showCost && this.sessionCost > 0;
      const showTokens = settings.showTokens && !hasSidebar && liveTokens > 0;
      if (showCost || showTokens) {
        const costPart = showCost ? fmtCost(this.animCost.get()) : "";
        const tokenPart = showTokens ? this.renderTokenSummaryParts().join(" ") : "";
        const statStr = [costPart, tokenPart].filter(Boolean).join(" · ");
        parts.push({ text: `${DIM}${statStr}${RESET}`, plain: statStr, priority: 4 });
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
    const reservedBottom = hasSidebar ? Math.max(bottomLines.length, footerLines.length) : bottomLines.length;
    const bottomPad = reservedBottom - bottomLines.length;
    const footerPad = reservedBottom - footerLines.length;
    const topHeight = Math.max(0, height - reservedBottom);
    this.activeMenuClickTargets = new Map(
      bottomMenuClicks.map(({ lineIndex, action }) => [topHeight + bottomPad + lineIndex + 1, action]),
    );

    // Compact header when no sidebar
    const showCompactHeader = !isHome && !hasSidebar && this.modelName !== "none";

    if (isHome) {
      if (showCompactHeader) frameLines.push(this.renderCompactHeader());
      const homeLines = this.renderHomeView(mainW, Math.max(0, topHeight - (showCompactHeader ? 1 : 0)));
      if (hasSidebar) {
        const sidebarLines = this.renderSidebar(homeLines.length);
        const border = this.getSidebarBorder();
        for (let i = 0; i < homeLines.length; i++) {
          const homeLine = this.padLine(homeLines[i] ?? "", mainW);
          const sidebarLine = this.padLine(sidebarLines[i] ?? "", this.screen.sidebarWidth);
          frameLines.push(`${homeLine} ${border} ${sidebarLine}`);
        }
      } else {
        frameLines.push(...homeLines);
      }
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
        const sidebarLines = this.renderSidebar(chatH);
        const border = this.getSidebarBorder();
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
      const border = this.getSidebarBorder();
      const sideW = this.screen.sidebarWidth;
      for (let i = 0; i < reservedBottom; i++) {
        const mainLine = i >= bottomPad ? bottomLines[i - bottomPad] ?? "" : "";
        const footerLine = i >= footerPad ? footerLines[i - footerPad] ?? "" : "";
        const padded = this.padLine(mainLine, mainW);
        frameLines.push(`${padded} ${border} ${this.padLine(footerLine, sideW)}`);
      }
    } else {
      for (const l of bottomLines) frameLines.push(l);
    }

    // CRITICAL: Ensure exactly `height` lines — pad or truncate
    while (frameLines.length < height) frameLines.push("");
    if (frameLines.length > height) frameLines.length = height;

    this.screen.render(frameLines.map((line) => this.decorateFrameLine(line, width)));

    // Hide cursor during streaming/pickers/compacting — no input focus
    if (this.isStreaming || this.isCompacting || this.modelPicker || this.settingsPicker || this.itemPicker || this.questionPrompt) {
      this.screen.hideCursor();
      return;
    }
    if (Date.now() < this.hideCursorUntil) {
      this.screen.hideCursor();
      return;
    }

    // Cursor on input line — account for multi-line input
    const inputRow = Math.min(height, topHeight + 2 + inputLayout.row); // +1 separator, +1 for 1-based
    const inputCol = Math.min(width, 1 + inputLayout.col);
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
    const pos = (frame * 0.25) % period;
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

  private appendModelPicker(lines: string[], _maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
    const picker = this.modelPicker!;
    lines.push(` ${T()}${BOLD}Select model${RESET}${picker.query ? `  ${DIM}/${RESET}${picker.query}` : ""}`);
    const allLabel = picker.scope === "all" ? `${TXT()}${BOLD}all${RESET}` : `${MUTED()}all${RESET}`;
    const scopedLabel = picker.scope === "scoped" ? `${TXT()}${BOLD}scoped${RESET}` : `${MUTED()}scoped${RESET}`;
    lines.push(` ${DIM}Scope:${RESET} ${allLabel} ${DIM}|${RESET} ${scopedLabel}`);

    if (this.getFilteredModels().length === 0) {
      lines.push(`  ${DIM}no matches${RESET}`);
      lines.push(` ${DIM}tab scope (all/scoped)${RESET}`);
      lines.push(` ${DIM}type to search, esc to close${RESET}`);
      return;
    }

    for (const entry of this.buildMenuView(this.getModelPickerEntries(), picker.cursor, 12)) {
      if (entry.selectIndex !== undefined) {
        this.registerMenuClickTarget(clickTargets, lines, () => this.selectModelEntry(entry.selectIndex!));
      }
      lines.push(entry.text);
    }
    lines.push(` ${DIM}(${Math.min(picker.cursor + 1, this.getFilteredModels().length)}/${this.getFilteredModels().length}) tab scope, space pin, enter select${RESET}`);
  }

  private decorateFrameLine(line: string, targetWidth: number): string {
    const visible = stripAnsi(line).length;
    const content = visible > targetWidth ? this.padLine(line, targetWidth) : line;
    const padded = Math.max(0, targetWidth - Math.min(visible, targetWidth));
    const bg = APP_BG();
    if (!bg) {
      return `${content}${" ".repeat(padded)}`;
    }
    const themedContent = content.replaceAll(RESET, `${RESET}${bg}`);
    return `${bg}${themedContent}${bg}${" ".repeat(padded)}${RESET}`;
  }

  private appendFilePicker(lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
    const picker = this.filePicker!;
    const maxItems = Math.max(1, maxTotal - 4);
    for (const entry of this.buildMenuView(this.getFilePickerEntries(), picker.cursor, maxItems)) {
      if (entry.selectIndex !== undefined) {
        this.registerMenuClickTarget(clickTargets, lines, () => this.selectFileEntry(entry.selectIndex!));
      }
      lines.push(entry.text);
    }
    if (picker.filtered.length === 0) {
      lines.push(` ${DIM}  no matches${RESET}`);
    }
    lines.push(` ${DIM}(${Math.min(picker.cursor + 1, picker.filtered.length)}/${picker.filtered.length} files)${RESET}`);
  }

  private appendSettingsPicker(lines: string[], _maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
    const picker = this.settingsPicker!;
    lines.push(` ${T()}${BOLD}Settings${RESET}${picker.query ? `  ${DIM}/${RESET}${picker.query}` : ""}`);

    const filtered = this.getFilteredSettings();
    if (filtered.length === 0) {
      lines.push(`  ${DIM}no matches${RESET}`);
      return;
    }

    for (const entry of this.buildMenuView(this.getSettingsPickerEntries(), picker.cursor, 6)) {
      if (entry.selectIndex !== undefined) {
        this.registerMenuClickTarget(clickTargets, lines, () => this.toggleSettingEntry(entry.selectIndex!));
      }
      lines.push(entry.text);
    }

    const selected = filtered[picker.cursor];
    if (selected) {
      lines.push(` ${DIM}${selected.description}${RESET}`);
    }
    lines.push(` ${DIM}(${Math.min(picker.cursor + 1, filtered.length)}/${filtered.length}) enter to toggle${RESET}`);
  }

  private appendItemPicker(lines: string[], _maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void {
    const picker = this.itemPicker!;
    lines.push(` ${T()}${BOLD}${picker.title}${RESET}${picker.query ? `  ${DIM}/${RESET}${picker.query}` : ""}`);

    const filtered = this.getFilteredItems();
    if (filtered.length === 0) {
      lines.push(`  ${DIM}no matches${RESET}`);
      return;
    }

    for (const entry of this.buildMenuView(this.getItemPickerEntries(), picker.cursor, 10)) {
      if (entry.selectIndex !== undefined) {
        this.registerMenuClickTarget(clickTargets, lines, () => this.selectItemEntry(entry.selectIndex!));
      }
      lines.push(entry.text);
    }
    if (picker.previewHint) {
      lines.push(` ${DIM}${picker.previewHint}${RESET}`);
    }
    if (picker.secondaryHint) {
      lines.push(` ${DIM}${picker.secondaryHint}${RESET}`);
    }
    lines.push(` ${DIM}(${Math.min(picker.cursor + 1, filtered.length)}/${filtered.length}) enter to select${RESET}`);
  }

  private getCommandMatches(): typeof COMMANDS {
    const text = this.input.getText();
    if (!text.startsWith("/")) return [];
    const query = text.slice(1).toLowerCase();
    if (!query && text === "/") return [...COMMANDS];
    return COMMANDS.filter((c) => {
      const matchesName = c.name.startsWith(query) && c.name !== query;
      const matchesAlias = c.aliases?.some((alias) => alias.startsWith(query)) ?? false;
      return matchesName || matchesAlias;
    });
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
      this.drawNow();
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
    process.stdout.on("resize", this.handleResize);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.clearInterruptPrompt();
    process.stdout.off("resize", this.handleResize);
    this.keypress.stop();
    this.screen.exit();
    this.screen.dispose();

    console.log("");
    console.log(`${T()}${BOLD} BrokeCLI${RESET} ${DIM}session ended${RESET}`);
    console.log(`${DIM} ${fmtCost(this.sessionCost)} | ${fmtTokens(this.sessionTokens)} tokens${RESET}`);
    console.log("");
    process.exit(0);
  }
}
