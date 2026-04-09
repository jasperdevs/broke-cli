import { execSync } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { Screen } from "./screen.js";
import { KeypressHandler } from "./keypress.js";
import { InputWidget } from "./input.js";
import { insertInlineImageChip } from "./inline-chip-utils.js";
import type { Mode, ThinkingLevel, CavemanLevel } from "../core/config.js";
import type { SidebarTreeItem } from "./sidebar.js";
import type { RgbColor } from "./render/mascot.js";
import type { AppMenuMethods } from "./app-menu-bindings.js";
import { appMenuMethods } from "./app-menu-bindings.js";
import type { AppInputMethods } from "./app-input-bindings.js";
import { appInputMethods } from "./app-input-bindings.js";
import type { AppRenderMethods } from "./app-render-bindings.js";
import { appRenderMethods } from "./app-render-bindings.js";
import type { AppDrawMethods } from "./app-draw-bindings.js";
import { appDrawMethods } from "./app-draw-bindings.js";
import type { AppStateCoreMethods } from "./app-state-core.js";
import { appStateCoreMethods } from "./app-state-core.js";
import type { AppStateMessageMethods } from "./app-state-messages.js";
import { appStateMessageMethods } from "./app-state-messages.js";
import type { AppStateUiMethods } from "./app-state-ui.js";
import { appStateUiMethods } from "./app-state-ui.js";
import { AnimCounter, HOME_TIPS } from "./app-shared.js";
import { APP_VERSION } from "../core/app-meta.js";
import type { BtwBubble, BudgetView, ChatMessage, ModelLaneOption, ModelOption, PendingImage, PendingMessage, PickerItem, QuestionView, SettingEntry, TodoItem, TreeView, UpdateNotice } from "./app-types.js";
import type { ModelPreferenceSlot } from "../core/config.js";
import type { ModelRuntime } from "../ai/providers.js";
import { createDefaultSessionName } from "../core/session.js";
import { createAppPickerState, createAppSidebarState, type AppPickerState, type AppSidebarState } from "./app-state-slices.js";

export interface App extends AppStateCoreMethods, AppStateMessageMethods, AppStateUiMethods, AppMenuMethods, AppInputMethods, AppRenderMethods, AppDrawMethods {}

export class App {
  private static readonly DRAW_THROTTLE_MS = 16;
  private static readonly ANIMATION_INTERVAL_MS = 250;

  private screen: Screen;
  private keypress: KeypressHandler;
  private input: InputWidget;
  private readonly handleResize = (): void => {
    this.screen.forceRedraw([]);
    this.draw();
  };

  private messages: ChatMessage[] = [];
  private thinkingBuffer = "";
  private thinkingRequested = false;
  private thinkingStartTime = 0;
  private thinkingDuration = 0;
  private streamingActivitySummary = "";
  private todoItems: TodoItem[] = [];
  private sessionCost = 0;
  private sessionInputTokens = 0;
  private sessionOutputTokens = 0;
  private sessionTokens = 0;
  private contextUsed = 0;
  private contextTokenCount = 0;
  private contextLimitTokens = 0;
  private modelName = "none";
  private providerName = "---";
  private modelProviderId = "";
  private modelRuntime: ModelRuntime = "sdk";
  private isStreaming = false;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private ctrlCCount = 0;
  private ctrlCTimeout: ReturnType<typeof setTimeout> | null = null;
  private scrollOffset = 0;
  private lastChatHeight = 0;
  private onSubmit: ((text: string) => void) | null = null;
  private onAbort: (() => void) | null = null;
  private running = false;
  private statusMessage: string | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private detectedProviders: string[] = [];
  private cwd = process.cwd();
  private readonly pickerState: AppPickerState = createAppPickerState();
  private readonly sidebarState: AppSidebarState = createAppSidebarState();
  private projectFiles: string[] | null = null;
  private fileContexts: Map<string, string> = new Map();
  private cmdSuggestionCursor = 0;
  private budgetView: BudgetView | null = null;
  private treeView: TreeView | null = null;
  private toolOutputCollapsed = false;
  private questionView: QuestionView | null = null;
  private pendingImages: PendingImage[] = [];
  private gitBranch = "";
  private gitDirty = false;
  private sessionName = createDefaultSessionName();
  private appVersion = APP_VERSION;
  private updateNotice: UpdateNotice | null = null;
  private mcpConnections: string[] = [];
  private onCycleScopedModel: (() => void) | null = null;
  private mode: Mode = "build";
  private onModeChange: ((mode: Mode) => void) | null = null;
  private onThinkingChange: ((level: ThinkingLevel) => void) | null = null;
  private onCavemanChange: ((level: CavemanLevel) => void) | null = null;
  private pendingMessages: PendingMessage[] = [];
  private onPendingMessagesReady: ((delivery: "steering" | "followup") => void) | null = null;
  private streamStartTime = 0;
  private streamTokens = 0;
  private toolCallGroups: Array<{ name: string; preview: string; args?: unknown; resultDetail?: string; result?: string; error?: boolean; expanded: boolean; streamOutput?: string; messageIndex?: number; startedAt?: number; completedAt?: number }> = [];
  private allToolsExpanded = false;
  private isCompacting = false;
  private escPrimed = false;
  private escAction: "stop" | "tree" | null = null;
  private escTimeout: ReturnType<typeof setTimeout> | null = null;
  private compactStartTime = 0;
  private compactTokens = 0;
  private hideCursorUntil = 0;
  private hideCursorTimer: NodeJS.Timeout | null = null;
  private activeMenuClickTargets = new Map<number, () => void>();
  private btwBubble: BtwBubble | null = null;
  private homeTip = HOME_TIPS[0];
  private mascotPathCache: string | null | undefined = undefined;
  private mascotGridCache = new Map<string, Array<Array<RgbColor | null>>>();
  private mascotAnsiCache = new Map<string, string[]>();
  private drawScheduled = false;
  private lastDrawTime = 0;
  private msgCacheWidth = 0;
  private msgCacheLen = 0;
  private msgCacheLines: string[] | null = null;

  private animTokens = new AnimCounter();
  private animInputTokens = new AnimCounter();
  private animOutputTokens = new AnimCounter();
  private animCost = new AnimCounter();
  private animStreamTokens = new AnimCounter();
  private animContext = new AnimCounter();

  private get modelPicker() { return this.pickerState.model; }
  private set modelPicker(value) { this.pickerState.model = value; }
  private get onModelSelect() { return this.pickerState.onModelSelect; }
  private set onModelSelect(value) { this.pickerState.onModelSelect = value; }
  private get onModelPin() { return this.pickerState.onModelPin; }
  private set onModelPin(value) { this.pickerState.onModelPin = value; }
  private get onModelAssign() { return this.pickerState.onModelAssign; }
  private set onModelAssign(value) { this.pickerState.onModelAssign = value; }
  private get modelLanePicker() { return this.pickerState.modelLane; }
  private set modelLanePicker(value) { this.pickerState.modelLane = value; }
  private get settingsPicker() { return this.pickerState.settings; }
  private set settingsPicker(value) { this.pickerState.settings = value; }
  private get onSettingToggle() { return this.pickerState.onSettingToggle; }
  private set onSettingToggle(value) { this.pickerState.onSettingToggle = value; }
  private get filePicker() { return this.pickerState.file; }
  private set filePicker(value) { this.pickerState.file = value; }
  private get itemPicker() { return this.pickerState.item; }
  private set itemPicker(value) { this.pickerState.item = value; }
  private get onTreeSelect() { return this.pickerState.onTreeSelect; }
  private set onTreeSelect(value) { this.pickerState.onTreeSelect = value; }
  private get onItemSelect() { return this.pickerState.onItemSelect; }
  private set onItemSelect(value) { this.pickerState.onItemSelect = value; }
  private get sidebarFileTree() { return this.sidebarState.fileTree; }
  private set sidebarFileTree(value) { this.sidebarState.fileTree = value; }
  private get sidebarExpandedDirs() { return this.sidebarState.expandedDirs; }
  private get sidebarTreeOpen() { return this.sidebarState.treeOpen; }
  private set sidebarTreeOpen(value) { this.sidebarState.treeOpen = value; }
  private get sidebarScrollOffset() { return this.sidebarState.scrollOffset; }
  private set sidebarScrollOffset(value) { this.sidebarState.scrollOffset = value; }
  private get sidebarFocused() { return this.sidebarState.focused; }
  private set sidebarFocused(value) { this.sidebarState.focused = value; }

  constructor() {
    this.screen = new Screen();
    this.input = new InputWidget();
    this.input.onChange((text) => {
      const normalized = text.trim();
      if (!normalized) return;
      const mirrored = this.pendingImages.find((image) =>
        image.attachmentId
        && (image.pendingPath === normalized || image.resolvedPath === normalized),
      );
      if (!mirrored?.attachmentId) return;
      this.input.setText("");
      insertInlineImageChip(this as any, mirrored.attachmentId);
    });
    this.keypress = new KeypressHandler(
      (key) => this.handleKey(key),
      (text) => this.handlePaste(text),
    );
    this.refreshHomeScreenData();
    try {
      this.gitBranch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 3000 }).trim();
    } catch {}
  }
}

Object.assign(
  App.prototype,
  appStateCoreMethods,
  appStateMessageMethods,
  appStateUiMethods,
  appMenuMethods,
  appInputMethods,
  appRenderMethods,
  appDrawMethods,
);

export const APP_DIR = dirname(fileURLToPath(import.meta.url));
