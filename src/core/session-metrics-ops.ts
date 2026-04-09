import {
  cloneRepoState,
  recordRepoEdit as updateRepoEditState,
  recordRepoRead as updateRepoReadState,
  recordRepoSearch as updateRepoSearchState,
  recordRepoVerification as updateRepoVerificationState,
} from "./repo-state.js";
import { createEmptySessionBudgetMetrics, createEmptySessionRepoState, type SessionBudgetMetrics, type SessionRepoState } from "./session-types.js";

export function createResetSessionMetrics(): {
  budgetMetrics: SessionBudgetMetrics;
  repoState: SessionRepoState;
} {
  return {
    budgetMetrics: createEmptySessionBudgetMetrics(),
    repoState: createEmptySessionRepoState(),
  };
}

export function cloneSessionRepoState(repoState: SessionRepoState): SessionRepoState {
  return cloneRepoState(repoState);
}

export function recordSessionRepoRead(repoState: SessionRepoState, path: string, lineCount: number, turn: number): SessionRepoState {
  return updateRepoReadState(repoState, path, lineCount, turn);
}

export function recordSessionRepoEdit(repoState: SessionRepoState, path: string, kind: "write" | "edit", turn: number): SessionRepoState {
  return updateRepoEditState(repoState, path, kind, turn);
}

export function recordSessionRepoSearch(
  repoState: SessionRepoState,
  tool: SessionRepoState["recentSearches"][number]["tool"],
  query: string,
  hits: string[],
  turn: number,
): SessionRepoState {
  return updateRepoSearchState(repoState, tool, query, hits, turn);
}

export function recordSessionVerification(
  repoState: SessionRepoState,
  label: string,
  status: "pass" | "fail",
  detail: string,
  turn: number,
): SessionRepoState {
  return updateRepoVerificationState(repoState, label, status, detail, turn);
}
