import { randomUUID } from "crypto";
import type { TreeFilterMode } from "./config.js";
import {
  buildChildrenMap,
  collectAncestorIds,
  getActiveEntries,
  matchesTreeFilter,
} from "./session-graph.js";
import type { SessionEntry, SessionTreeItem } from "./session-types.js";

export function getSessionTreeItems(
  entries: SessionEntry[],
  leafId: string | null,
  filterMode: TreeFilterMode = "all",
): SessionTreeItem[] {
  const allItems: SessionTreeItem[] = [];
  const children = buildChildrenMap(entries);
  const activeIds = new Set(getActiveEntries(entries, leafId).map((entry) => entry.id));

  const visit = (entry: SessionEntry, depth: number): void => {
    const childEntries = [...(children.get(entry.id) ?? [])].sort((a, b) => {
      const aActive = activeIds.has(a.id) ? 0 : 1;
      const bActive = activeIds.has(b.id) ? 0 : 1;
      return aActive - bActive || a.timestamp - b.timestamp;
    });
    allItems.push({
      ...entry,
      depth,
      active: activeIds.has(entry.id),
      hasChildren: childEntries.length > 0,
    });
    for (const child of childEntries) visit(child, depth + 1);
  };

  for (const root of children.get(null) ?? []) visit(root, 0);
  if (filterMode === "all") return allItems;
  if (filterMode === "labeled-only") return allItems.filter((item) => matchesTreeFilter(item, filterMode));

  const byId = new Map(allItems.map((item) => [item.id, item]));
  const visibleIds = new Set<string>();
  for (const item of allItems) {
    if (!matchesTreeFilter(item, filterMode) && !item.active) continue;
    let cursor: SessionEntry | undefined = item;
    while (cursor) {
      visibleIds.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  return allItems.filter((item) => visibleIds.has(item.id));
}

export function getEntriesToSummarizeForNavigation(
  entries: SessionEntry[],
  leafId: string | null,
  targetId: string,
): SessionEntry[] {
  const target = entries.find((entry) => entry.id === targetId);
  if (!target || !leafId) return [];
  const currentPath = getActiveEntries(entries, leafId);
  const targetLeafId = target.role === "user" ? target.parentId : target.id;
  const targetAncestors = collectAncestorIds(entries, targetLeafId);
  const abandoned: SessionEntry[] = [];
  for (let i = currentPath.length - 1; i >= 0; i--) {
    const entry = currentPath[i];
    if (targetAncestors.has(entry.id)) break;
    if (entry.role === "user" || entry.role === "assistant") abandoned.unshift(entry);
  }
  return abandoned;
}

export function toggleEntryLabel(entries: SessionEntry[], entryId: string, label?: string): { labeled: boolean; value?: string } {
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry) return { labeled: false };
  if (entry.label) {
    delete entry.label;
    delete entry.labelTimestamp;
    return { labeled: false };
  }
  const fallback = entry.content.split(/\r?\n/)[0]?.trim().slice(0, 80) || entry.role;
  entry.label = (label?.trim() || fallback).trim();
  entry.labelTimestamp = Date.now();
  return { labeled: true, value: entry.label };
}

export function navigateToEntry(entries: SessionEntry[], targetId: string): { leafId: string | null; editorText?: string; cancelled: boolean } {
  const target = entries.find((entry) => entry.id === targetId);
  if (!target) return { leafId: null, cancelled: true };
  if (target.role === "user") {
    return { leafId: target.parentId, editorText: target.content, cancelled: false };
  }
  return { leafId: target.id, cancelled: false };
}

export function appendBranchSummaryEntry(
  entries: SessionEntry[],
  leafId: string | null,
  options?: { summary?: string; label?: string },
): { entries: SessionEntry[]; leafId: string | null; summaryEntryId?: string } {
  if (!options?.summary?.trim()) {
    return { entries, leafId };
  }
  const entry: SessionEntry = {
    id: randomUUID(),
    parentId: leafId,
    role: "system",
    content: `[Branch summary]\n${options.summary.trim()}`,
    timestamp: Date.now(),
    label: options.label?.trim() || "branch summary",
    labelTimestamp: Date.now(),
  };
  return {
    entries: [...entries, entry],
    leafId: entry.id,
    summaryEntryId: entry.id,
  };
}
