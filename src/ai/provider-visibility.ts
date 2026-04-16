import {
  getModelSpec,
  getProviderMaxVisibleModelCount,
  getProviderPreferredDisplayModelIds,
} from "./model-catalog.js";
import { getProviderCompat } from "./provider-compat.js";
import { LOCAL_PROVIDER_IDS, PROVIDERS } from "./provider-definitions.js";
import { getLocalModelMetadata } from "./local-model-metadata.js";

function getNormalizedModelGroup(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/:(free|exacto|beta)$/g, "")
    .replace(/-(latest|beta|preview|preview-[\w-]+)$/g, "")
    .replace(/-\d{8}$/g, "")
    .replace(/-\d{6}$/g, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/g, "")
    .replace(/-(\d+)(?:\.\d+)?-non-reasoning$/g, "-$1")
    .replace(/-non-reasoning$/g, "")
    .replace(/-vision$/g, "")
    .replace(/-image$/g, "");
}

function modelVisibilityScore(providerId: string, modelId: string): number {
  const lower = modelId.toLowerCase();
  let score = 0;
  const preferred = getProviderPreferredDisplayModelIds(providerId);
  const preferredIndex = preferred.indexOf(modelId);
  if (preferredIndex >= 0) score += 500 - preferredIndex * 20;
  if (lower.includes("codex")) score += 120;
  if (lower.includes("codestral")) score += 80;
  if (lower.includes("sonnet")) score += 70;
  if (lower.includes("haiku")) score += 40;
  if (lower.includes("mini")) score += 30;
  if (lower.includes("flash")) score += 25;
  if (lower.includes("latest")) score += 10;
  if (lower.includes("preview")) score -= 40;
  if (/\d{8}/.test(lower) || /\d{6}/.test(lower)) score -= 30;
  return score;
}

export function filterModelIdsForDisplay(providerId: string, modelIds: string[], preserve: string[] = []): string[] {
  if (LOCAL_PROVIDER_IDS.has(providerId)) {
    const keep = [...new Set([...preserve, ...modelIds])].filter((modelId) => {
      if (preserve.includes(modelId)) return true;
      const meta = getLocalModelMetadata(providerId, modelId);
      if (!meta) return true;
      if (meta.toolCall === false) return false;
      return true;
    });
    keep.sort((left, right) => {
      const leftMeta = getLocalModelMetadata(providerId, left);
      const rightMeta = getLocalModelMetadata(providerId, right);
      return Number(rightMeta?.toolCall === true) - Number(leftMeta?.toolCall === true)
        || Number(rightMeta?.reasoning === true) - Number(leftMeta?.reasoning === true)
        || right.localeCompare(left);
    });
    return keep;
  }

  const preserveSet = new Set(preserve);
  const seenGroups = new Set<string>();
  const selected: string[] = [];

  const candidates = [...new Set(modelIds)].filter((modelId) => {
    if (preserveSet.has(modelId)) return true;

    const lower = modelId.toLowerCase();
    const spec = getModelSpec(modelId, providerId);
    if (providerId === "openai" && /^(?:gpt-4\.1|o[34])(?:-|$)/.test(lower)) return false;
    if (getProviderCompat(providerId, modelId).supportsTools === false) return false;
    const family = spec?.family?.toLowerCase() ?? "";
    const inputModalities = spec?.modalities?.input ?? [];
    const outputModalities = spec?.modalities?.output ?? [];

    const excludedById = [
      /(^|\/)(gpt-image|chatgpt-image|pixtral|whisper|tts|transcribe|embedding|moderation|guard|safeguard)/,
      /(^|[-/])(image|vision)([-/]|$)/,
      /(^|[-/])(audio|realtime|live)([-/]|$)/,
      /(^|[-/])(computer-use|search-preview|embedding)([-/]|$)/,
    ].some((pattern) => pattern.test(lower));
    if (excludedById) return false;

    if (["embedding", "text-embedding", "image", "moderation", "speech"].some((kind) => family.includes(kind))) {
      return false;
    }

    if (outputModalities.length > 0 && !outputModalities.includes("text")) return false;
    if (inputModalities.length > 0 && !inputModalities.includes("text")) return false;

    return true;
  });

  candidates.sort((a, b) => {
    const scoreDiff = modelVisibilityScore(providerId, b) - modelVisibilityScore(providerId, a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.localeCompare(b);
  });

  for (const modelId of [...preserve, ...candidates]) {
    if (selected.includes(modelId)) continue;
    const group = getNormalizedModelGroup(modelId);
    if (!preserveSet.has(modelId) && seenGroups.has(group)) continue;
    selected.push(modelId);
    seenGroups.add(group);
  }

  const maxVisible = getProviderMaxVisibleModelCount(providerId);
  const visible = selected.filter((modelId) => preserveSet.has(modelId));
  for (const modelId of selected) {
    if (visible.includes(modelId)) continue;
    if (visible.length >= maxVisible + preserveSet.size) break;
    visible.push(modelId);
  }
  return visible;
}

export function getDisplayModels(providerId: string, preserve: string[] = []): string[] {
  const provider = PROVIDERS[providerId];
  if (!provider) return [];
  return filterModelIdsForDisplay(providerId, provider.models, preserve);
}
