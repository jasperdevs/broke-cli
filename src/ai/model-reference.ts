export interface ModelReferenceCandidate {
  providerId: string;
  providerName?: string;
  modelId: string;
  displayName?: string;
}

export interface ResolvedModelReference {
  providerId: string;
  modelId: string;
  key: string;
}

export function isModelAlias(modelId: string): boolean {
  if (modelId.endsWith("-latest")) return true;
  return !/-\d{8}$/.test(modelId)
    && !/-\d{4}-\d{2}-\d{2}$/.test(modelId)
    && !/-\d{2}-\d{2}$/.test(modelId)
    && !/-\d{2}-\d{4}$/.test(modelId);
}

export function toModelReference(candidate: ModelReferenceCandidate): ResolvedModelReference {
  return {
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    key: `${candidate.providerId}/${candidate.modelId}`,
  };
}

export function findExactModelReferenceMatch<T extends ModelReferenceCandidate>(
  modelReference: string,
  candidates: readonly T[],
): T | undefined {
  const trimmed = modelReference.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.toLowerCase();

  const canonicalMatches = candidates.filter((candidate) =>
    `${candidate.providerId}/${candidate.modelId}`.toLowerCase() === normalized);
  if (canonicalMatches.length === 1) return canonicalMatches[0];
  if (canonicalMatches.length > 1) return undefined;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex !== -1) {
    const providerId = trimmed.slice(0, slashIndex).trim().toLowerCase();
    const modelId = trimmed.slice(slashIndex + 1).trim().toLowerCase();
    if (providerId && modelId) {
      const providerMatches = candidates.filter((candidate) =>
        candidate.providerId.toLowerCase() === providerId
        && candidate.modelId.toLowerCase() === modelId);
      if (providerMatches.length === 1) return providerMatches[0];
      if (providerMatches.length > 1) return undefined;
    }
  }

  const bareMatches = candidates.filter((candidate) => candidate.modelId.toLowerCase() === normalized);
  return bareMatches.length === 1 ? bareMatches[0] : undefined;
}

export function resolveModelReferencePattern<T extends ModelReferenceCandidate>(
  pattern: string,
  candidates: readonly T[],
): T | undefined {
  const exact = findExactModelReferenceMatch(pattern, candidates);
  if (exact) return exact;

  const query = pattern.trim().toLowerCase();
  if (!query) return undefined;
  const matches = candidates.filter((candidate) =>
    candidate.modelId.toLowerCase().includes(query)
    || candidate.displayName?.toLowerCase().includes(query)
    || candidate.providerName?.toLowerCase().includes(query));
  if (matches.length === 0) return undefined;

  const aliases = matches.filter((candidate) => isModelAlias(candidate.modelId));
  const pool = aliases.length > 0 ? aliases : matches;
  pool.sort((left, right) =>
    right.modelId.localeCompare(left.modelId)
    || left.providerId.localeCompare(right.providerId));
  return pool[0];
}
