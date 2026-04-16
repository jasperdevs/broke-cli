import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const GENERATED_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ai", "model-catalog.generated.json");

const EXTRA_ID_ONLY_MODELS = {
  "google-gemini-cli": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  "google-antigravity": ["gemini-3.1-pro-high", "gemini-3.1-pro-low", "gemini-3-flash", "claude-sonnet-4-6"],
};

function pickNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickStringArray(value) {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item) => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

function isUsableCodingModel(modelId, raw) {
  const model = raw && typeof raw === "object" ? raw : {};
  if (model.tool_call !== true) return false;
  const lower = modelId.toLowerCase();
  if (/(^|[-_/])(audio|embedding|image|moderation|realtime|speech|tts|transcribe|whisper)([-_/]|$)/.test(lower)) return false;
  const input = pickStringArray(model.modalities?.input);
  const output = pickStringArray(model.modalities?.output);
  if (input && !input.includes("text")) return false;
  if (output && !output.includes("text")) return false;
  return true;
}

function normalizeModel(modelId, raw) {
  const model = raw && typeof raw === "object" ? raw : {};
  const cost = model.cost && typeof model.cost === "object" ? model.cost : undefined;
  const limit = model.limit && typeof model.limit === "object" ? model.limit : undefined;
  const modalities = model.modalities && typeof model.modalities === "object" ? model.modalities : undefined;
  const normalized = {
    id: typeof model.id === "string" ? model.id : modelId,
    name: typeof model.name === "string" ? model.name : modelId,
  };
  if (typeof model.family === "string") normalized.family = model.family;
  if (typeof model.attachment === "boolean") normalized.attachment = model.attachment;
  if (typeof model.reasoning === "boolean") normalized.reasoning = model.reasoning;
  if (typeof model.tool_call === "boolean") normalized.tool_call = model.tool_call;
  if (modalities) {
    const input = pickStringArray(modalities.input);
    const output = pickStringArray(modalities.output);
    if (input || output) normalized.modalities = { ...(input ? { input } : {}), ...(output ? { output } : {}) };
  }
  if (cost) {
    const normalizedCost = {
      input: pickNumber(cost.input),
      output: pickNumber(cost.output),
      reasoning: pickNumber(cost.reasoning),
      cache_read: pickNumber(cost.cache_read),
      cache_write: pickNumber(cost.cache_write),
    };
    for (const key of Object.keys(normalizedCost)) if (normalizedCost[key] === undefined) delete normalizedCost[key];
    if (Object.keys(normalizedCost).length > 0) normalized.cost = normalizedCost;
  }
  const normalizedLimit = {
    context: pickNumber(limit?.context),
    input: pickNumber(limit?.input),
    output: pickNumber(limit?.output),
  };
  for (const key of Object.keys(normalizedLimit)) if (normalizedLimit[key] === undefined) delete normalizedLimit[key];
  normalized.limit = normalizedLimit;
  return normalized;
}

function normalizeCatalog(rawCatalog) {
  const catalog = {};
  for (const providerId of Object.keys(rawCatalog).sort()) {
    const rawProvider = rawCatalog[providerId];
    if (!rawProvider || typeof rawProvider !== "object" || !rawProvider.models) continue;
    const models = {};
    for (const modelId of Object.keys(rawProvider.models).sort()) {
      if (!isUsableCodingModel(modelId, rawProvider.models[modelId])) continue;
      models[modelId] = normalizeModel(modelId, rawProvider.models[modelId]);
    }
    if (Object.keys(models).length === 0) continue;
    catalog[providerId] = {
      id: typeof rawProvider.id === "string" ? rawProvider.id : providerId,
      name: typeof rawProvider.name === "string" ? rawProvider.name : providerId,
      models,
    };
  }
  for (const [providerId, modelIds] of Object.entries(EXTRA_ID_ONLY_MODELS)) {
    catalog[providerId] ??= { id: providerId, name: providerId, models: {} };
    for (const modelId of modelIds) {
      catalog[providerId].models[modelId] ??= { id: modelId, name: modelId, limit: {} };
    }
  }
  return catalog;
}

async function main() {
  try {
    const response = await fetch(MODELS_DEV_API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = normalizeCatalog(await response.json());
    mkdirSync(dirname(GENERATED_PATH), { recursive: true });
    writeFileSync(GENERATED_PATH, `${JSON.stringify(catalog)}\n`, "utf-8");
    console.log(`Generated ${GENERATED_PATH}`);
  } catch (error) {
    if (existsSync(GENERATED_PATH)) {
      console.warn(`Keeping existing generated model catalog: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    throw error;
  }
}

await main();
