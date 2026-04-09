export type Mode = "build" | "plan";
export type ModeSwitchingPolicy = "manual" | "ask" | "auto";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type CavemanLevel = "off" | "lite" | "auto" | "ultra";
export type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";
export type ModelPreferenceSlot = "default" | "small" | "btw" | "review" | "planning" | "ui" | "architecture";

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
  blockImages: boolean;
}

export interface MarkdownSettings {
  codeBlockIndent: string;
}

export interface AutonomySettings {
  allowNetwork: boolean;
  allowReadOutsideWorkspace: boolean;
  allowWriteOutsideWorkspace: boolean;
  allowShellOutsideWorkspace: boolean;
  allowDestructiveShell: boolean;
  additionalReadRoots: string[];
  additionalWriteRoots: string[];
}

export interface Settings {
  autoCompact: boolean;
  enablePromptCaching: boolean;
  enablePlannedScaffolds: boolean;
  memoizeToolResults: boolean;
  modelGeneratedSessionNames: boolean;
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
  lastModel: string;
  mode: Mode;
  modeSwitching: ModeSwitchingPolicy;
  cavemanLevel: CavemanLevel;
  autoLint: boolean;
  autoTest: boolean;
  autoFixValidation: boolean;
  lintCommand: string;
  testCommand: string;
  disabledTools: string[];
  disabledExtensions: string[];
  quietStartup: boolean;
  editorPaddingX: number;
  autocompleteMaxVisible: number;
  showHardwareCursor: boolean;
  sessionDir: string;
  hideThinkingBlock: boolean;
  thinkingBudgets: Partial<Record<Exclude<ThinkingLevel, "off">, number>>;
  compaction: CompactionSettings;
  retry: RetrySettings;
  terminal: TerminalSettings;
  images: ImageSettings;
  npmCommand: string[];
  markdown: MarkdownSettings;
  autonomy: AutonomySettings;
  packages: PackageSource[];
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
  theme: string;
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
  defaultBtwModel?: string;
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
