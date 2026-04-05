import type { BrokecliConfig } from "./schema.js";

export const DEFAULT_CONFIG: BrokecliConfig = {
  providers: {},
  routing: {
    strategy: "manual",
    defaultModel: undefined,
    localFallback: true,
    thinkingLevel: "medium",
  },
  budget: {
    daily: undefined,
    monthly: undefined,
    session: undefined,
    warningThreshold: 0.8,
  },
  context: {
    reduceVerbosity: true,
    compaction: "auto",
    compactionThreshold: 0.8,
    maxOutputLines: 200,
    preferDiffs: true,
  },
  cache: {
    enabled: true,
    maxEntries: 1000,
    ttlSeconds: 3600,
  },
  permissions: {
    allow: [],
    deny: [],
    autoApprove: [],
  },
  ui: {
    theme: "dark",
    showCostTicker: true,
    showThinking: true,
    collapseToolCalls: false,
  },
  mcp: {},
  hooks: {},
};
