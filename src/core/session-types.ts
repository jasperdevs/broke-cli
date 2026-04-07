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
  plannerCacheHits: number;
  plannerCacheMisses: number;
  plannerInputTokens: number;
  plannerOutputTokens: number;
  executorInputTokens: number;
  executorOutputTokens: number;
}

export interface SessionData {
  id: string;
  name?: string;
  cwd: string;
  provider: string;
  model: string;
  messages?: Message[];
  entries?: SessionEntry[];
  leafId?: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  budgetMetrics?: SessionBudgetMetrics;
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
    plannerCacheHits: 0,
    plannerCacheMisses: 0,
    plannerInputTokens: 0,
    plannerOutputTokens: 0,
    executorInputTokens: 0,
    executorOutputTokens: 0,
  };
}
