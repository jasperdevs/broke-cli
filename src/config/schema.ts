import { z } from "zod";

export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  enabled: z.boolean().default(true),
});

export const RoutingConfigSchema = z.object({
  strategy: z.enum(["manual", "cheapest", "quality", "broke"]).default("manual"),
  defaultModel: z.string().optional(),
  localFallback: z.boolean().default(true),
  thinkingLevel: z
    .enum(["off", "minimal", "low", "medium", "high", "max"])
    .default("medium"),
});

export const BudgetConfigSchema = z.object({
  daily: z.number().optional(),
  monthly: z.number().optional(),
  session: z.number().optional(),
  warningThreshold: z.number().default(0.8),
});

export const ContextConfigSchema = z.object({
  reduceVerbosity: z.boolean().default(true),
  compaction: z.enum(["auto", "manual", "off"]).default("auto"),
  compactionThreshold: z.number().default(0.8),
  maxOutputLines: z.number().default(200),
  preferDiffs: z.boolean().default(true),
});

export const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxEntries: z.number().default(1000),
  ttlSeconds: z.number().default(3600),
});

export const PermissionsConfigSchema = z.object({
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
  autoApprove: z.array(z.string()).default([]),
});

export const UiConfigSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  showCostTicker: z.boolean().default(true),
  showThinking: z.boolean().default(true),
  collapseToolCalls: z.boolean().default(false),
});

export const McpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
});

export const HookEntrySchema = z.object({
  command: z.string(),
  matcher: z.string().optional(),
});

export const BrokecliConfigSchema = z.object({
  providers: z.record(ProviderConfigSchema).default({}),
  routing: RoutingConfigSchema.default({}),
  budget: BudgetConfigSchema.default({}),
  context: ContextConfigSchema.default({}),
  cache: CacheConfigSchema.default({}),
  permissions: PermissionsConfigSchema.default({}),
  ui: UiConfigSchema.default({}),
  mcp: z.record(McpServerSchema).default({}),
  hooks: z.record(z.array(HookEntrySchema)).default({}),
});

export type BrokecliConfig = z.infer<typeof BrokecliConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;
export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;
export type ContextConfig = z.infer<typeof ContextConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;
export type UiConfig = z.infer<typeof UiConfigSchema>;
