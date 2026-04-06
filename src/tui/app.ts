import { execSync } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { Screen } from "./screen.js";
import { KeypressHandler } from "./keypress.js";
import { InputWidget } from "./input.js";
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
import type { AppStateUiMethods } from "./app-state-ui.js";
import { appStateUiMethods } from "./app-state-ui.js";
import { AnimCounter, HOME_TIPS } from "./app-shared.js";
import type { BudgetView, ChatMessage, ModelOption, PendingImage, PendingMessage, PickerItem, QuestionPrompt, SettingEntry, TodoItem } from "./app-types.js";

export interface App extends AppStateCoreMethods, AppStateUiMethods, AppMenuMethods, AppInputMethods, AppRenderMethods, AppDrawMethods {}

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
  private detectedProviders: string[] = [];
  private cwd = process.cwd();
  private modelPicker: { options: ModelOption[]; cursor: number; scope: "all" | "scoped" } | null = null;
  private onModelSelect: ((providerId: string, modelId: string) => void) | null = null;
  private onModelPin: ((providerId: string, modelId: string, pinned: boolean) => void) | null = null;
  private settingsPicker: { entries: SettingEntry[]; cursor: number } | null = null;
  private onSettingToggle: ((key: string) => void) | null = null;
  private filePicker: { files: string[]; filtered: string[]; query: string; cursor: number } | null = null;
  private projectFiles: string[] | null = null;
  private fileContexts: Map<string, string> = new Map();
  private cmdSuggestionCursor = 0;
  private itemPicker: {
    title: string;
    items: PickerItem[];
    cursor: number;
    kind?: "model" | "settings" | "permissions" | "extensions" | "theme" | "export" | "resume" | "projects" | "logout";
    previewHint?: string;
    onPreview?: (id: string) => void;
    onCancel?: () => void;
    onSecondaryAction?: (id: string) => void;
    secondaryHint?: string;
    closeOnSelect?: boolean;
  } | null = null;
  private budgetView: BudgetView | null = null;
  private onItemSelect: ((id: string) => void) | null = null;
  private toolOutputCollapsed = false;
  private questionPrompt: QuestionPrompt | null = null;
  private pendingImages: PendingImage[] = [];
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
  private pendingMessages: PendingMessage[] = [];
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

  constructor() {
    this.screen = new Screen();
    this.input = new InputWidget();
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
  appStateUiMethods,
  appMenuMethods,
  appInputMethods,
  appRenderMethods,
  appDrawMethods,
);

export const APP_DIR = dirname(fileURLToPath(import.meta.url));
