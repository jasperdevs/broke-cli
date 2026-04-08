import {
  type RepoStateSearch,
  type SessionRepoState,
} from "./session-types.js";

export const REPO_STATE_CONTEXT_PREFIX = `Repo work state for continuity:

<repo-state>
`;

export const REPO_STATE_CONTEXT_SUFFIX = `
</repo-state>`;

const MAX_REPO_STATE_ITEMS = 6;

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pushRecentUnique<T>(
  entries: T[],
  next: T,
  keyOf: (entry: T) => string,
  limit = MAX_REPO_STATE_ITEMS,
): T[] {
  const key = keyOf(next);
  const filtered = entries.filter((entry) => keyOf(entry) !== key);
  return [next, ...filtered].slice(0, limit);
}

export function buildRepoStateSummary(state: SessionRepoState): string | null {
  const lines: string[] = [];
  if (state.recentEdits.length > 0) {
    lines.push(`edited: ${state.recentEdits.map((entry) => `${entry.path} (${entry.kind})`).join(", ")}`);
  }
  if (state.recentReads.length > 0) {
    lines.push(`read: ${state.recentReads.map((entry) => `${entry.path} (${entry.lineCount} lines)`).join(", ")}`);
  }
  if (state.recentSearches.length > 0) {
    lines.push(`search: ${state.recentSearches.map((entry) => `${entry.tool} ${entry.query}${entry.hits.length > 0 ? ` -> ${entry.hits.join(", ")}` : ""}`).join(" | ")}`);
  }
  if (state.lastVerification) {
    lines.push(`verify: ${state.lastVerification.status} ${state.lastVerification.label}${state.lastVerification.detail ? ` · ${state.lastVerification.detail}` : ""}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function buildRepoStateContextMessage(summary: string): string {
  return `${REPO_STATE_CONTEXT_PREFIX}${summary.trim()}${REPO_STATE_CONTEXT_SUFFIX}`;
}

export function cloneRepoState(state: SessionRepoState): SessionRepoState {
  return {
    recentReads: [...state.recentReads],
    recentEdits: [...state.recentEdits],
    recentSearches: state.recentSearches.map((entry) => ({ ...entry, hits: [...entry.hits] })),
    lastVerification: state.lastVerification ? { ...state.lastVerification } : null,
  };
}

export function recordRepoRead(
  state: SessionRepoState,
  path: string,
  lineCount: number,
  turn: number,
): SessionRepoState {
  const normalized = normalizeRepoPath(path);
  if (!normalized) return state;
  return {
    ...state,
    recentReads: pushRecentUnique(
      state.recentReads,
      { path: normalized, lineCount, turn },
      (entry) => entry.path,
    ),
  };
}

export function recordRepoEdit(
  state: SessionRepoState,
  path: string,
  kind: "write" | "edit",
  turn: number,
): SessionRepoState {
  const normalized = normalizeRepoPath(path);
  if (!normalized) return state;
  return {
    ...state,
    recentEdits: pushRecentUnique(
      state.recentEdits,
      { path: normalized, kind, turn },
      (entry) => entry.path,
    ),
  };
}

export function recordRepoSearch(
  state: SessionRepoState,
  tool: RepoStateSearch["tool"],
  query: string,
  hits: string[],
  turn: number,
): SessionRepoState {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return state;
  return {
    ...state,
    recentSearches: pushRecentUnique(
      state.recentSearches,
      {
        tool,
        query: normalizedQuery.length > 80 ? `${normalizedQuery.slice(0, 77)}...` : normalizedQuery,
        hits: hits.map(normalizeRepoPath).filter(Boolean).slice(0, 3),
        turn,
      },
      (entry) => `${entry.tool}:${entry.query}`,
    ),
  };
}

export function recordRepoVerification(
  state: SessionRepoState,
  label: string,
  status: "pass" | "fail",
  detail: string,
  turn: number,
): SessionRepoState {
  return {
    ...state,
    lastVerification: {
      label: label.trim().slice(0, 80) || "verify",
      status,
      detail: detail.trim().slice(0, 160),
      turn,
    },
  };
}
