import type { ContextOptimizer } from "../core/context-optimizer.js";

export interface ActiveToolContext {
  contextOptimizer: ContextOptimizer | null;
  memoizedToolResults: boolean;
}

let activeToolContext: ActiveToolContext | null = null;

export function setActiveToolContext(context: ActiveToolContext | null): void {
  activeToolContext = context;
}

export function getActiveToolContext(): ActiveToolContext | null {
  return activeToolContext;
}
