import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { join, resolve } from "path";
import { homedir } from "os";
import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod";
import { getBaseUrl } from "./config.js";
import type { ProviderCompatSettings } from "../ai/provider-compat-types.js";

export type ProviderApiType = "openai-completions" | "anthropic-messages" | "google-generative-ai";

export interface ConfiguredModelCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ConfiguredModelDefinition {
  id: string;
  name?: string;
  api?: ProviderApiType;
  compat?: ProviderCompatSettings;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  cost?: ConfiguredModelCost;
  headers?: Record<string, string>;
}

export interface ConfiguredProviderDefinition {
  name?: string;
  baseUrl?: string;
  api?: ProviderApiType;
  apiKey?: string;
  compat?: ProviderCompatSettings;
  headers?: Record<string, string>;
  authHeader?: boolean;
  defaultModel?: string;
  models?: ConfiguredModelDefinition[];
  modelOverrides?: Record<string, Partial<Omit<ConfiguredModelDefinition, "id">>>;
}

export interface ModelsConfig {
  providers?: Record<string, ConfiguredProviderDefinition>;
}

const CONFIG_DIR = join(homedir(), ".brokecli");
const GLOBAL_MODELS_FILE = join(CONFIG_DIR, "models.json");

const costSchema = z.object({
  input: z.number().optional(),
  output: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
});

const apiTypeSchema = z.enum(["openai-completions", "anthropic-messages", "google-generative-ai"]);
const compatSchema = z.object({
  supportsDeveloperRole: z.boolean().optional(),
  supportsReasoningEffort: z.boolean().optional(),
  supportsUsageInStreaming: z.boolean().optional(),
  supportsTools: z.boolean().optional(),
  maxTokensField: z.enum(["max_completion_tokens", "max_tokens"]).optional(),
  thinkingFormat: z.enum(["openai", "qwen"]).optional(),
});

const modelDefinitionSchema: z.ZodType<ConfiguredModelDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  api: apiTypeSchema.optional(),
  compat: compatSchema.optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(["text", "image"])).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  cost: costSchema.optional(),
  headers: z.record(z.string()).optional(),
});

const modelOverrideSchema = z.object({
  name: z.string().optional(),
  api: apiTypeSchema.optional(),
  compat: compatSchema.optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(["text", "image"])).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  cost: costSchema.optional(),
  headers: z.record(z.string()).optional(),
});

const providerDefinitionSchema: z.ZodType<ConfiguredProviderDefinition> = z.object({
  name: z.string().optional(),
  baseUrl: z.string().optional(),
  api: apiTypeSchema.optional(),
  apiKey: z.string().optional(),
  compat: compatSchema.optional(),
  headers: z.record(z.string()).optional(),
  authHeader: z.boolean().optional(),
  defaultModel: z.string().optional(),
  models: z.array(modelDefinitionSchema).optional(),
  modelOverrides: z.record(modelOverrideSchema).optional(),
});

const modelsConfigSchema: z.ZodType<ModelsConfig> = z.object({
  providers: z.record(providerDefinitionSchema).optional(),
});

let runtimePathsOverride: { global?: string; project?: string } | null = null;

function getGlobalModelsConfigPath(): string {
  return runtimePathsOverride?.global ?? GLOBAL_MODELS_FILE;
}

function getProjectModelsConfigPath(cwd = process.cwd()): string {
  return runtimePathsOverride?.project ?? join(resolve(cwd, ".brokecli"), "models.json");
}

function readModelsConfigFile(path: string): ModelsConfig {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    return modelsConfigSchema.parse(parseJsonc(raw) ?? {});
  } catch {
    return {};
  }
}

function mergeProviderDefinitions(
  base: ConfiguredProviderDefinition | undefined,
  override: ConfiguredProviderDefinition | undefined,
): ConfiguredProviderDefinition | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base ?? {}),
    ...(override ?? {}),
    headers: { ...(base?.headers ?? {}), ...(override?.headers ?? {}) },
    modelOverrides: { ...(base?.modelOverrides ?? {}), ...(override?.modelOverrides ?? {}) },
    models: override?.models ?? base?.models,
  };
}

function mergeModelsConfigs(base: ModelsConfig, override: ModelsConfig): ModelsConfig {
  const providers = new Set([
    ...Object.keys(base.providers ?? {}),
    ...Object.keys(override.providers ?? {}),
  ]);
  const mergedProviders: Record<string, ConfiguredProviderDefinition> = {};
  for (const providerId of providers) {
    const merged = mergeProviderDefinitions(base.providers?.[providerId], override.providers?.[providerId]);
    if (merged) mergedProviders[providerId] = merged;
  }
  return Object.keys(mergedProviders).length > 0 ? { providers: mergedProviders } : {};
}

function executeSecretCommand(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  const shell = process.platform === "win32" ? "powershell" : "bash";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-Command", trimmed]
    : ["-lc", trimmed];
  try {
    const result = spawnSync(shell, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    if (result.status !== 0 || result.error) return undefined;
    const output = result.stdout.trim();
    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}

function resolveConfigValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("!")) return executeSecretCommand(trimmed.slice(1));
  if (/^[A-Z0-9_]+$/u.test(trimmed) && process.env[trimmed]) return process.env[trimmed];
  return trimmed;
}

export function loadModelsConfig(cwd = process.cwd()): ModelsConfig {
  return mergeModelsConfigs(
    readModelsConfigFile(getGlobalModelsConfigPath()),
    readModelsConfigFile(getProjectModelsConfigPath(cwd)),
  );
}

export function getConfiguredProviderDefinition(providerId: string, cwd = process.cwd()): ConfiguredProviderDefinition | undefined {
  return loadModelsConfig(cwd).providers?.[providerId];
}

export function listConfiguredProviderIds(cwd = process.cwd()): string[] {
  return Object.keys(loadModelsConfig(cwd).providers ?? {});
}

export function getConfiguredProviderName(providerId: string, cwd = process.cwd()): string | undefined {
  return getConfiguredProviderDefinition(providerId, cwd)?.name;
}

export function getConfiguredProviderBaseUrl(providerId: string, cwd = process.cwd()): string | undefined {
  return getConfiguredProviderDefinition(providerId, cwd)?.baseUrl?.trim()
    ?? getBaseUrl(providerId);
}

export function getConfiguredProviderApi(providerId: string, cwd = process.cwd()): ProviderApiType | undefined {
  return getConfiguredProviderDefinition(providerId, cwd)?.api;
}

export function getConfiguredProviderApiKey(providerId: string, cwd = process.cwd()): string | undefined {
  return resolveConfigValue(getConfiguredProviderDefinition(providerId, cwd)?.apiKey);
}

export function getConfiguredProviderHeaders(providerId: string, cwd = process.cwd()): Record<string, string> | undefined {
  const headers = getConfiguredProviderDefinition(providerId, cwd)?.headers;
  if (!headers) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const next = resolveConfigValue(value);
    if (next) resolved[key] = next;
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

export function getConfiguredProviderAuthHeader(providerId: string, cwd = process.cwd()): boolean {
  return getConfiguredProviderDefinition(providerId, cwd)?.authHeader === true;
}

export function getConfiguredProviderDefaultModel(providerId: string, cwd = process.cwd()): string | undefined {
  return getConfiguredProviderDefinition(providerId, cwd)?.defaultModel?.trim();
}

export function getConfiguredProviderModels(providerId: string, cwd = process.cwd()): ConfiguredModelDefinition[] {
  return getConfiguredProviderDefinition(providerId, cwd)?.models ?? [];
}

export function getConfiguredProviderModel(providerId: string, modelId: string, cwd = process.cwd()): ConfiguredModelDefinition | undefined {
  return getConfiguredProviderModels(providerId, cwd).find((model) => model.id === modelId);
}

export function getConfiguredProviderModelOverride(
  providerId: string,
  modelId: string,
  cwd = process.cwd(),
): Partial<Omit<ConfiguredModelDefinition, "id">> | undefined {
  return getConfiguredProviderDefinition(providerId, cwd)?.modelOverrides?.[modelId];
}

export function setRuntimeModelsConfigPathsForTests(paths: { global?: string; project?: string } | null): void {
  runtimePathsOverride = paths;
}
