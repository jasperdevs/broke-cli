export type Mode = "build" | "plan";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type CavemanLevel = "off" | "lite" | "auto" | "ultra";
export type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";
export type ModelPreferenceSlot = "default" | "small" | "review" | "planning" | "ui" | "architecture";

export interface PackageFilterSource {
  source: string;
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

export type PackageSource = string | PackageFilterSource;

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface BranchSummarySettings {
  reserveTokens: number;
  skipPrompt: boolean;
}

export interface RetrySettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface TerminalSettings {
  showImages: boolean;
  clearOnShrink: boolean;
}

export interface ImageSettings {
  autoResize: boolean;
  blockImages: boolean;
}

export interface MarkdownSettings {
  codeBlockIndent: string;
}

export interface Settings {
  yoloMode: boolean;
  autoCompact: boolean;
  maxSessionCost: number;
  showTokens: boolean;
  showCost: boolean;
  autoSaveSessions: boolean;
  enableThinking: boolean;
  thinkingLevel: ThinkingLevel;
  gitCheckpoints: boolean;
  notifyOnResponse: boolean;
  hideSidebar: boolean;
  autoRoute: boolean;
  scopedModels: string[];
  favoriteThemes: string[];
  lastModel: string;
  mode: Mode;
  cavemanLevel: CavemanLevel;
  theme: string;
  autoLint: boolean;
  autoTest: boolean;
  autoFixValidation: boolean;
  lintCommand: string;
  testCommand: string;
  deniedTools: string[];
  disabledExtensions: string[];
  quietStartup: boolean;
  editorPaddingX: number;
  autocompleteMaxVisible: number;
  showHardwareCursor: boolean;
  sessionDir: string;
  defaultThinkingLevel: ThinkingLevel;
  hideThinkingBlock: boolean;
  thinkingBudgets: Partial<Record<Exclude<ThinkingLevel, "off">, number>>;
  compaction: CompactionSettings;
  branchSummary: BranchSummarySettings;
  retry: RetrySettings;
  terminal: TerminalSettings;
  images: ImageSettings;
  shellPath: string;
  shellCommandPrefix: string;
  npmCommand: string[];
  enabledModels: string[];
  markdown: MarkdownSettings;
  packages: PackageSource[];
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
  enableSkillCommands: boolean;
  discoverExtensions: boolean;
  discoverSkills: boolean;
  discoverPrompts: boolean;
  discoverThemes: boolean;
}

export interface BrokeConfig {
  defaultProvider?: string;
  defaultModel?: string;
  defaultSmallModel?: string;
  defaultReviewModel?: string;
  defaultPlanningModel?: string;
  defaultUiModel?: string;
  defaultArchitectureModel?: string;
  budget?: { maxSessionCost?: number; maxMonthlyCost?: number };
  providers?: Record<string, { apiKey?: string; baseUrl?: string; disabled?: boolean }>;
  modelContextLimits?: Record<string, number>;
  settings?: Partial<Settings>;
}

export type ProviderCredentialKind = "api_key" | "native_oauth" | "none";

export interface ProviderCredential {
  kind: ProviderCredentialKind;
  value?: string;
  source?: string;
}
