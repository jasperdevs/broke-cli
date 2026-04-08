import { randomUUID } from "crypto";
import type { TreeFilterMode } from "./config.js";
import type { Message, SessionEntry } from "./session-types.js";

function makeEntry(message: Message, parentId: string | null): SessionEntry {
  return { ...message, id: randomUUID(), parentId };
}

export function entriesFromMessages(messages: Message[]): { entries: SessionEntry[]; leafId: string | null } {
  const entries: SessionEntry[] = [];
  let parentId: string | null = null;
  for (const message of messages) {
    const entry = makeEntry(message, parentId);
    entries.push(entry);
    parentId = entry.id;
  }
  return { entries, leafId: parentId };
}

function getEntryMap(entries: SessionEntry[]): Map<string, SessionEntry> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

export function getActiveEntries(entries: SessionEntry[], leafId: string | null): SessionEntry[] {
  if (!leafId) return [];
  const map = getEntryMap(entries);
  const path: SessionEntry[] = [];
  let cursor: string | null = leafId;
  while (cursor) {
    const entry = map.get(cursor);
    if (!entry) break;
    path.push(entry);
    cursor = entry.parentId;
  }
  return path.reverse();
}

export function buildChildrenMap(entries: SessionEntry[]): Map<string | null, SessionEntry[]> {
  const children = new Map<string | null, SessionEntry[]>();
  for (const entry of entries) {
    const bucket = children.get(entry.parentId) ?? [];
    bucket.push(entry);
    children.set(entry.parentId, bucket);
  }
  for (const bucket of children.values()) {
    bucket.sort((a, b) => a.timestamp - b.timestamp);
  }
  return children;
}

export function collectAncestorIds(entries: SessionEntry[], entryId: string | null): Set<string> {
  const map = getEntryMap(entries);
  const ids = new Set<string>();
  let cursor = entryId;
  while (cursor) {
    ids.add(cursor);
    cursor = map.get(cursor)?.parentId ?? null;
  }
  return ids;
}

export function matchesTreeFilter(entry: SessionEntry, mode: TreeFilterMode): boolean {
  switch (mode) {
    case "all":
      return true;
    case "user-only":
      return entry.role === "user";
    case "labeled-only":
      return !!entry.label;
    case "no-tools":
    case "default":
    default:
      return entry.role !== "system";
  }
}
