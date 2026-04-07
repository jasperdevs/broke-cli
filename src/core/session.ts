import { randomUUID } from "crypto";
import { ContextOptimizer } from "./context-optimizer.js";
import { getSettings, type TreeFilterMode } from "./config.js";
import { buildCompactionContextMessage } from "./compact.js";
import {
  type CompactionSummaryState,
  createEmptySessionBudgetMetrics,
  type Message,
  type SessionBudgetMetrics,
  type SessionData,
  type SessionEntry,
  type SessionListItem,
  type SessionTreeItem,
} from "./session-types.js";
import {
  listRecentSessions,
  loadSessionData,
  saveSessionData,
} from "./session-storage.js";

export type {
  Message,
  SessionBudgetMetrics,
  SessionData,
  SessionEntry,
  SessionListItem,
  SessionTreeItem,
} from "./session-types.js";

function makeEntry(message: Message, parentId: string | null): SessionEntry {
  return { ...message, id: randomUUID(), parentId };
}

function entriesFromMessages(messages: Message[]): { entries: SessionEntry[]; leafId: string | null } {
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

function getActiveEntries(entries: SessionEntry[], leafId: string | null): SessionEntry[] {
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

function buildChildrenMap(entries: SessionEntry[]): Map<string | null, SessionEntry[]> {
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

function collectAncestorIds(entries: SessionEntry[], entryId: string | null): Set<string> {
  const map = getEntryMap(entries);
  const ids = new Set<string>();
  let cursor = entryId;
  while (cursor) {
    ids.add(cursor);
    cursor = map.get(cursor)?.parentId ?? null;
  }
  return ids;
}

function matchesTreeFilter(entry: SessionEntry, mode: TreeFilterMode): boolean {
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

export class Session {
  private id: string;
  private name = "New Session";
  private entries: SessionEntry[] = [];
  private leafId: string | null = null;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCost = 0;
  private budgetMetrics: SessionBudgetMetrics = createEmptySessionBudgetMetrics();
  private compactionSummary: CompactionSummaryState | null = null;
  private cwd = process.cwd();
  private provider = "";
  private model = "";
  private createdAt = Date.now();
  private readonly contextOptimizer = new ContextOptimizer();

  constructor(id?: string) {
    this.id = id ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  }

  getId(): string { return this.id; }
  getName(): string { return this.name; }
  setName(name: string): void {
    this.name = name.trim() || "New Session";
    this.save();
  }
  getCwd(): string { return this.cwd; }
  getProvider(): string { return this.provider; }
  getModel(): string { return this.model; }
  getCreatedAt(): number { return this.createdAt; }
  getUpdatedAt(): number {
    return this.entries[this.entries.length - 1]?.timestamp ?? this.createdAt;
  }
  getEntryCount(): number { return this.entries.length; }
  getActivePathLength(): number { return getActiveEntries(this.entries, this.leafId).length; }
  getLeafId(): string | null { return this.leafId; }

  getContextOptimizer(): ContextOptimizer {
    return this.contextOptimizer;
  }

  setProviderModel(provider: string, model: string): void {
    this.provider = provider;
    this.model = model;
  }

  addMessage(role: Message["role"], content: string, images?: Array<{ mimeType: string; data: string }>): void {
    this.entries.push({
      id: randomUUID(),
      parentId: this.leafId,
      role,
      content,
      timestamp: Date.now(),
      images,
    });
    this.leafId = this.entries[this.entries.length - 1]?.id ?? null;
    this.save();
  }

  getMessages(): Message[] {
    return getActiveEntries(this.entries, this.leafId)
      .map(({ id: _id, parentId: _parentId, label: _label, labelTimestamp: _labelTimestamp, ...message }) => message);
  }

  getChatMessages(): Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }> {
    const visibleMessages = this.getMessages()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, images: m.images }));
    if (!this.compactionSummary?.summary?.trim()) return visibleMessages;
    return [
      { role: "user", content: buildCompactionContextMessage(this.compactionSummary.summary) },
      ...visibleMessages,
    ];
  }

  getCompactionSummary(): CompactionSummaryState | null {
    return this.compactionSummary ? { ...this.compactionSummary } : null;
  }

  getTreeItems(filterMode: TreeFilterMode = "all"): SessionTreeItem[] {
    const allItems: SessionTreeItem[] = [];
    const children = buildChildrenMap(this.entries);
    const activeIds = new Set(getActiveEntries(this.entries, this.leafId).map((entry) => entry.id));

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

  getTreeEntry(entryId: string): SessionEntry | undefined {
    return this.entries.find((entry) => entry.id === entryId);
  }

  getEntriesToSummarizeForNavigation(targetId: string): SessionEntry[] {
    const target = this.getTreeEntry(targetId);
    if (!target || !this.leafId) return [];
    const currentPath = getActiveEntries(this.entries, this.leafId);
    const targetLeafId = target.role === "user" ? target.parentId : target.id;
    const targetAncestors = collectAncestorIds(this.entries, targetLeafId);
    const abandoned: SessionEntry[] = [];
    for (let i = currentPath.length - 1; i >= 0; i--) {
      const entry = currentPath[i];
      if (targetAncestors.has(entry.id)) break;
      if (entry.role === "user" || entry.role === "assistant") abandoned.unshift(entry);
    }
    return abandoned;
  }

  toggleLabel(entryId: string, label?: string): { labeled: boolean; value?: string } {
    const entry = this.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return { labeled: false };
    if (entry.label) {
      delete entry.label;
      delete entry.labelTimestamp;
      this.save();
      return { labeled: false };
    }
    const fallback = entry.content.split(/\r?\n/)[0]?.trim().slice(0, 80) || entry.role;
    entry.label = (label?.trim() || fallback).trim();
    entry.labelTimestamp = Date.now();
    this.save();
    return { labeled: true, value: entry.label };
  }

  navigateTo(targetId: string): { editorText?: string; cancelled: boolean } {
    const target = this.entries.find((entry) => entry.id === targetId);
    if (!target) return { cancelled: true };
    if (target.role === "user") {
      this.leafId = target.parentId;
      this.save();
      return { editorText: target.content, cancelled: false };
    }
    this.leafId = target.id;
    this.save();
    return { cancelled: false };
  }

  navigateTree(targetId: string, options?: { summary?: string; label?: string }): { editorText?: string; cancelled: boolean; summaryEntryId?: string } {
    const navigation = this.navigateTo(targetId);
    if (navigation.cancelled) return navigation;
    let summaryEntryId: string | undefined;
    if (options?.summary?.trim()) {
      const entry: SessionEntry = {
        id: randomUUID(),
        parentId: this.leafId,
        role: "system",
        content: `[Branch summary]\n${options.summary.trim()}`,
        timestamp: Date.now(),
        label: options.label?.trim() || "branch summary",
        labelTimestamp: Date.now(),
      };
      this.entries.push(entry);
      this.leafId = entry.id;
      summaryEntryId = entry.id;
    } else if (options?.label?.trim()) {
      const target = this.getTreeEntry(targetId);
      if (target) {
        target.label = options.label.trim();
        target.labelTimestamp = Date.now();
      }
    }
    this.save();
    return { ...navigation, summaryEntryId };
  }

  addUsage(inputTokens: number, outputTokens: number, cost: number): void {
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalCost += cost;
    this.save();
  }

  getTotalTokens(): number {
    return this.totalInputTokens + this.totalOutputTokens;
  }

  getTotalInputTokens(): number {
    return this.totalInputTokens;
  }

  getTotalOutputTokens(): number {
    return this.totalOutputTokens;
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  replaceConversation(messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>): void {
    const next = entriesFromMessages(messages.map((message) => ({
      role: message.role,
      content: message.content,
      images: message.images,
      timestamp: Date.now(),
    })));
    this.entries = next.entries;
    this.leafId = next.leafId;
    this.compactionSummary = null;
    this.contextOptimizer.reset();
    this.save();
  }

  applyCompaction(
    summary: string,
    messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>,
    tokensBefore: number,
  ): void {
    const next = entriesFromMessages(messages.map((message) => ({
      role: message.role,
      content: message.content,
      images: message.images,
      timestamp: Date.now(),
    })));
    this.entries = next.entries;
    this.leafId = next.leafId;
    this.compactionSummary = {
      summary: summary.trim(),
      tokensBefore,
      timestamp: Date.now(),
    };
    this.contextOptimizer.reset();
    this.save();
  }

  getBudgetMetrics(): SessionBudgetMetrics {
    return { ...this.budgetMetrics };
  }

  recordTurn(options: {
    smallModel?: boolean;
    toolsExposed?: number;
    toolsUsed?: number;
    plannerCacheHit?: boolean;
    plannerInputTokens?: number;
    plannerOutputTokens?: number;
    executorInputTokens?: number;
    executorOutputTokens?: number;
  }): void {
    this.budgetMetrics.totalTurns += 1;
    if (options.smallModel) this.budgetMetrics.smallModelTurns += 1;
    if (options.toolsExposed) this.budgetMetrics.toolsExposed += options.toolsExposed;
    if (options.toolsUsed) this.budgetMetrics.toolsUsed += options.toolsUsed;
    if (options.plannerCacheHit === true) this.budgetMetrics.plannerCacheHits += 1;
    if (options.plannerCacheHit === false) this.budgetMetrics.plannerCacheMisses += 1;
    if (options.plannerInputTokens) this.budgetMetrics.plannerInputTokens += options.plannerInputTokens;
    if (options.plannerOutputTokens) this.budgetMetrics.plannerOutputTokens += options.plannerOutputTokens;
    if (options.executorInputTokens) this.budgetMetrics.executorInputTokens += options.executorInputTokens;
    if (options.executorOutputTokens) this.budgetMetrics.executorOutputTokens += options.executorOutputTokens;
    this.save();
  }

  recordShellRecovery(): void {
    this.budgetMetrics.shellRecoveries += 1;
    this.save();
  }

  recordToolResult(toolName: string, approxTokens: number): void {
    if (!toolName || approxTokens <= 0) return;
    this.budgetMetrics.toolOutputTokens[toolName] = (this.budgetMetrics.toolOutputTokens[toolName] ?? 0) + approxTokens;
    this.budgetMetrics.toolCallsByName[toolName] = (this.budgetMetrics.toolCallsByName[toolName] ?? 0) + 1;
    this.save();
  }

  recordIdleCacheCliff(): void {
    this.budgetMetrics.idleCacheCliffs += 1;
    this.save();
  }

  recordCompaction(options?: { freshThreadCarryForward?: boolean }): void {
    this.budgetMetrics.autoCompactions += 1;
    if (options?.freshThreadCarryForward) this.budgetMetrics.freshThreadCarryForwards += 1;
    this.save();
  }

  clear(): void {
    this.entries = [];
    this.leafId = null;
    this.compactionSummary = null;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCost = 0;
    this.budgetMetrics = createEmptySessionBudgetMetrics();
    this.contextOptimizer.reset();
    this.save();
  }

  private save(): void {
    saveSessionData({
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      provider: this.provider,
      model: this.model,
      compactionSummary: this.compactionSummary,
      messages: this.getMessages(),
      entries: this.entries,
      leafId: this.leafId,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCost: this.totalCost,
      budgetMetrics: this.budgetMetrics,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
    });
  }

  static load(id: string): Session | null {
    const data = loadSessionData(id);
    if (!data) return null;
    const session = new Session(data.id);
    session.name = data.name?.trim() || "New Session";
    if (data.entries) {
      session.entries = data.entries;
      session.leafId = data.leafId ?? data.entries[data.entries.length - 1]?.id ?? null;
    } else {
      const converted = entriesFromMessages(data.messages ?? []);
      session.entries = converted.entries;
      session.leafId = converted.leafId;
    }
    session.totalInputTokens = data.totalInputTokens;
    session.totalOutputTokens = data.totalOutputTokens;
    session.totalCost = data.totalCost;
    session.compactionSummary = data.compactionSummary ?? null;
    session.budgetMetrics = {
      ...session.budgetMetrics,
      ...(data.budgetMetrics ?? {}),
    };
    session.cwd = data.cwd;
    session.provider = data.provider;
    session.model = data.model;
    session.createdAt = data.createdAt;
    return session;
  }

  fork(): Session {
    const forked = new Session();
      forked.entries = structuredClone(this.entries);
      forked.name = `${this.name} (fork)`;
      forked.leafId = this.leafId;
    forked.compactionSummary = this.compactionSummary ? { ...this.compactionSummary } : null;
    forked.totalInputTokens = this.totalInputTokens;
    forked.totalOutputTokens = this.totalOutputTokens;
    forked.totalCost = this.totalCost;
    forked.cwd = this.cwd;
    forked.provider = this.provider;
    forked.model = this.model;
    forked.createdAt = Date.now();
    forked.save();
    return forked;
  }

  static listRecent(limit = 10, query = "", cwd?: string): SessionListItem[] {
    return listRecentSessions(limit, query, cwd);
  }
}
