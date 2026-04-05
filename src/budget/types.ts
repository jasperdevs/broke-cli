/** A single usage record persisted to the ledger */
export interface UsageRecord {
  id: string;
  sessionId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
  timestamp: Date;
}

/** Current budget state computed from the ledger */
export interface BudgetState {
  dailySpend: number;
  monthlySpend: number;
  sessionSpend: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  sessionLimit?: number;
}

/** Result of a budget check */
export interface BudgetCheck {
  allowed: boolean;
  reason?: string;
  /** 0-1 ratio of how much budget has been used (highest of all limits) */
  usageRatio: number;
}
