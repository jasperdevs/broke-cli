export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  images?: Array<{ mimeType: string; data: string }>;
}

export interface SessionEntry extends Message {
  id: string;
  parentId: string | null;
  label?: string;
  labelTimestamp?: number;
}

export interface SessionTreeItem extends SessionEntry {
  depth: number;
  active: boolean;
  hasChildren: boolean;
}

export interface SessionBudgetMetrics {
  totalTurns: number;
  smallModelTurns: number;
  idleCacheCliffs: number;
  autoCompactions: number;
  freshThreadCarryForwards: number;
  toolsExposed: number;
  toolsUsed: number;
  shellRecoveries: number;
  plannerCacheHits: number;
  plannerCacheMisses: number;
  plannerInputTokens: number;
  plannerOutputTokens: number;
  executorInputTokens: number;
  executorOutputTokens: number;
  systemPromptTokens: number;
  replayInputTokens: number;
  stateCarrierTokens: number;
  transientContextTokens: number;
  visibleOutputTokens: number;
  hiddenOutputTokens: number;
  toolOutputTokens: Record<string, number>;
  toolCallsByName: Record<string, number>;
}

export interface RepoStateRead {
  path: string;
  lineCount: number;
  turn: number;
}

export interface RepoStateEdit {
  path: string;
  kind: "write" | "edit";
  turn: number;
}

export interface RepoStateSearch {
  tool: "grep" | "semSearch" | "listFiles";
  query: string;
  hits: string[];
  turn: number;
}

export interface RepoStateVerification {
  label: string;
  status: "pass" | "fail";
  detail: string;
  turn: number;
}

export interface SessionRepoState {
  recentReads: RepoStateRead[];
  recentEdits: RepoStateEdit[];
  recentSearches: RepoStateSearch[];
  lastVerification: RepoStateVerification | null;
}

export interface CompactionSummaryState {
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

export interface SessionData {
  id: string;
  name?: string;
  cwd: string;
  provider: string;
  model: string;
  compactionSummary?: CompactionSummaryState | null;
  messages?: Message[];
  entries?: SessionEntry[];
  leafId?: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  budgetMetrics?: SessionBudgetMetrics;
  repoState?: SessionRepoState;
  createdAt: number;
  updatedAt: number;
}

export interface SessionListItem {
  id: string;
  cwd: string;
  model: string;
  cost: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
}

export function createEmptySessionBudgetMetrics(): SessionBudgetMetrics {
  return {
    totalTurns: 0,
    smallModelTurns: 0,
    idleCacheCliffs: 0,
    autoCompactions: 0,
    freshThreadCarryForwards: 0,
    toolsExposed: 0,
    toolsUsed: 0,
    shellRecoveries: 0,
    plannerCacheHits: 0,
    plannerCacheMisses: 0,
    plannerInputTokens: 0,
    plannerOutputTokens: 0,
    executorInputTokens: 0,
    executorOutputTokens: 0,
    systemPromptTokens: 0,
    replayInputTokens: 0,
    stateCarrierTokens: 0,
    transientContextTokens: 0,
    visibleOutputTokens: 0,
    hiddenOutputTokens: 0,
    toolOutputTokens: {},
    toolCallsByName: {},
  };
}

export function createEmptySessionRepoState(): SessionRepoState {
  return {
    recentReads: [],
    recentEdits: [],
    recentSearches: [],
    lastVerification: null,
  };
}
