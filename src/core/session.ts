import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { homedir } from "os";
import { ContextOptimizer } from "./context-optimizer.js";
import { getSettings, type TreeFilterMode } from "./config.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  images?: Array<{ mimeType: string; data: string }>;
}

export interface SessionEntry extends Message {
  id: string;
  parentId: string | null;
  label?: string;
  labelTimestamp?: number;
}

export interface SessionTreeItem extends SessionEntry {
  depth: number;
  active: boolean;
  hasChildren: boolean;
}

interface SessionData {
  id: string;
  name?: string;
  cwd: string;
  provider: string;
  model: string;
  messages?: Message[];
  entries?: SessionEntry[];
  leafId?: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  budgetMetrics?: SessionBudgetMetrics;
  createdAt: number;
  updatedAt: number;
}

export interface SessionBudgetMetrics {
  totalTurns: number;
  smallModelTurns: number;
  idleCacheCliffs: number;
  autoCompactions: number;
  freshThreadCarryForwards: number;
  toolsExposed: number;
  toolsUsed: number;
  plannerCacheHits: number;
  plannerCacheMisses: number;
}

function resolveSessionsDir(): string {
  const configured = getSettings().sessionDir?.trim();
  if (!configured) return join(homedir(), ".brokecli", "sessions");
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

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

function getMessagesForData(data: SessionData): Message[] {
  if (data.entries) {
    return getActiveEntries(data.entries, data.leafId ?? data.entries[data.entries.length - 1]?.id ?? null)
      .map(({ id: _id, parentId: _parentId, label: _label, labelTimestamp: _labelTimestamp, ...message }) => message);
  }
  return data.messages ?? [];
}

export class Session {
  private id: string;
  private name = "New Session";
  private entries: SessionEntry[] = [];
  private leafId: string | null = null;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCost = 0;
  private budgetMetrics: SessionBudgetMetrics = {
    totalTurns: 0,
    smallModelTurns: 0,
    idleCacheCliffs: 0,
    autoCompactions: 0,
    freshThreadCarryForwards: 0,
    toolsExposed: 0,
    toolsUsed: 0,
    plannerCacheHits: 0,
    plannerCacheMisses: 0,
  };
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
    return this.getMessages()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, images: m.images }));
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
    this.contextOptimizer.reset();
    this.save();
  }

  getBudgetMetrics(): SessionBudgetMetrics {
    return { ...this.budgetMetrics };
  }

  recordTurn(options: { smallModel?: boolean; toolsExposed?: number; toolsUsed?: number; plannerCacheHit?: boolean }): void {
    this.budgetMetrics.totalTurns += 1;
    if (options.smallModel) this.budgetMetrics.smallModelTurns += 1;
    if (options.toolsExposed) this.budgetMetrics.toolsExposed += options.toolsExposed;
    if (options.toolsUsed) this.budgetMetrics.toolsUsed += options.toolsUsed;
    if (options.plannerCacheHit === true) this.budgetMetrics.plannerCacheHits += 1;
    if (options.plannerCacheHit === false) this.budgetMetrics.plannerCacheMisses += 1;
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
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCost = 0;
    this.budgetMetrics = {
      totalTurns: 0,
      smallModelTurns: 0,
      idleCacheCliffs: 0,
      autoCompactions: 0,
      freshThreadCarryForwards: 0,
      toolsExposed: 0,
      toolsUsed: 0,
      plannerCacheHits: 0,
      plannerCacheMisses: 0,
    };
    this.contextOptimizer.reset();
    this.save();
  }

  private save(): void {
    if (!getSettings().autoSaveSessions) return;
    try {
      const sessionsDir = resolveSessionsDir();
      mkdirSync(sessionsDir, { recursive: true });
      const data: SessionData = {
        id: this.id,
        name: this.name,
        cwd: this.cwd,
        provider: this.provider,
        model: this.model,
        messages: this.getMessages(),
        entries: this.entries,
        leafId: this.leafId,
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        totalCost: this.totalCost,
        budgetMetrics: this.budgetMetrics,
        createdAt: this.createdAt,
        updatedAt: Date.now(),
      };
      writeFileSync(join(sessionsDir, `${this.id}.json`), JSON.stringify(data), "utf-8");
    } catch {
      // silently fail - sessions are optional
    }
  }

  static load(id: string): Session | null {
    try {
      const path = join(resolveSessionsDir(), `${id}.json`);
      const raw = readFileSync(path, "utf-8");
      const data: SessionData = JSON.parse(raw);
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
      session.budgetMetrics = {
        ...session.budgetMetrics,
        ...(data.budgetMetrics ?? {}),
      };
      session.cwd = data.cwd;
      session.provider = data.provider;
      session.model = data.model;
      session.createdAt = data.createdAt;
      return session;
    } catch {
      return null;
    }
  }

  fork(): Session {
    const forked = new Session();
      forked.entries = structuredClone(this.entries);
      forked.name = `${this.name} (fork)`;
      forked.leafId = this.leafId;
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

  static listRecent(limit = 10, query = "", cwd?: string): Array<{ id: string; cwd: string; model: string; cost: number; updatedAt: number; messageCount: number; preview: string }> {
    if (!getSettings().autoSaveSessions) return [];
    try {
      const sessionsDir = resolveSessionsDir();
      if (!existsSync(sessionsDir)) return [];
      const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
      const normalized = query.trim().toLowerCase();
      const sessions = files.map((f) => {
        try {
          const raw = readFileSync(join(sessionsDir, f), "utf-8");
          const data: SessionData = JSON.parse(raw);
          const messages = getMessagesForData(data);
          const preview = messages.find((msg) => msg.role === "user")?.content?.split(/\r?\n/)[0]?.slice(0, 120) ?? "";
          return {
            id: data.id,
            cwd: data.cwd,
            model: `${data.provider}/${data.model}`,
            cost: data.totalCost,
            updatedAt: data.updatedAt,
            messageCount: messages.length,
            preview,
          };
        } catch {
          return null;
        }
      }).filter(Boolean) as Array<{ id: string; cwd: string; model: string; cost: number; updatedAt: number; messageCount: number; preview: string }>;

      return sessions
        .filter((entry) => !cwd || entry.cwd === cwd)
        .filter((entry) => {
          if (!normalized) return true;
          return entry.cwd.toLowerCase().includes(normalized)
            || entry.model.toLowerCase().includes(normalized)
            || entry.preview.toLowerCase().includes(normalized);
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
    } catch {
      return [];
    }
  }
}
