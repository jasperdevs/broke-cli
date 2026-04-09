import { randomUUID } from "crypto";
import { ContextOptimizer } from "./context-optimizer.js";
import { getSettings, type TreeFilterMode } from "./config.js";
import { buildCompactionContextMessage } from "./compact.js";
import {
  buildRepoStateContextMessage,
  buildRepoStateSummary,
} from "./repo-state.js";
import { createDefaultSessionName } from "./session-naming.js";
import { entriesFromMessages, getActiveEntries } from "./session-graph.js";
import {
  type CompactionSummaryState,
  createEmptySessionBudgetMetrics,
  createEmptySessionRepoState,
  type Message,
  type SessionBudgetMetrics,
  type SessionData,
  type SessionEntry,
  type SessionListItem,
  type SessionRepoState,
  type SessionTreeItem,
} from "./session-types.js";
import {
  listRecentSessions,
  loadSessionData,
  saveSessionData,
} from "./session-storage.js";
import {
  appendBranchSummaryEntry,
  getEntriesToSummarizeForNavigation,
  getSessionTreeItems,
  navigateToEntry,
  toggleEntryLabel,
} from "./session-tree-ops.js";
import {
  cloneSessionRepoState,
  createResetSessionMetrics,
  recordSessionRepoEdit,
  recordSessionRepoRead,
  recordSessionRepoSearch,
  recordSessionVerification,
} from "./session-metrics-ops.js";

export type {
  Message,
  SessionBudgetMetrics,
  SessionData,
  SessionEntry,
  SessionListItem,
  SessionTreeItem,
} from "./session-types.js";
export { createDefaultSessionName, isDefaultSessionName } from "./session-naming.js";
export {
  REPO_STATE_CONTEXT_PREFIX,
  REPO_STATE_CONTEXT_SUFFIX,
  buildRepoStateContextMessage,
} from "./repo-state.js";

export class Session {
  private id: string;
  private name = createDefaultSessionName();
  private entries: SessionEntry[] = [];
  private leafId: string | null = null;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCost = 0;
  private budgetMetrics: SessionBudgetMetrics = createEmptySessionBudgetMetrics();
  private compactionSummary: CompactionSummaryState | null = null;
  private repoState: SessionRepoState = createEmptySessionRepoState();
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
    this.name = name.trim() || createDefaultSessionName();
    this.save();
  }
  resetName(): void {
    this.name = createDefaultSessionName();
    this.save();
  }
  getCwd(): string { return this.cwd; }
  setCwd(cwd: string): void { this.cwd = cwd; }
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
    const contextMessages: Array<{ role: "user"; content: string }> = [];
    if (this.compactionSummary?.summary?.trim()) {
      contextMessages.push({ role: "user", content: buildCompactionContextMessage(this.compactionSummary.summary) });
    }
    const repoStateSummary = buildRepoStateSummary(this.repoState);
    if (repoStateSummary) {
      contextMessages.push({ role: "user", content: buildRepoStateContextMessage(repoStateSummary) });
    }
    return [...contextMessages, ...visibleMessages];
  }

  getCompactionSummary(): CompactionSummaryState | null {
    return this.compactionSummary ? { ...this.compactionSummary } : null;
  }

  getTreeItems(filterMode: TreeFilterMode = "all"): SessionTreeItem[] {
    return getSessionTreeItems(this.entries, this.leafId, filterMode);
  }

  getTreeEntry(entryId: string): SessionEntry | undefined {
    return this.entries.find((entry) => entry.id === entryId);
  }

  getEntriesToSummarizeForNavigation(targetId: string): SessionEntry[] {
    return getEntriesToSummarizeForNavigation(this.entries, this.leafId, targetId);
  }

  toggleLabel(entryId: string, label?: string): { labeled: boolean; value?: string } {
    const result = toggleEntryLabel(this.entries, entryId, label);
    this.save();
    return result;
  }

  navigateTo(targetId: string): { editorText?: string; cancelled: boolean } {
    const navigation = navigateToEntry(this.entries, targetId);
    if (navigation.cancelled) return { cancelled: true };
    this.leafId = navigation.leafId;
    this.save();
    return { editorText: navigation.editorText, cancelled: false };
  }

  navigateTree(targetId: string, options?: { summary?: string; label?: string }): { editorText?: string; cancelled: boolean; summaryEntryId?: string } {
    const navigation = this.navigateTo(targetId);
    if (navigation.cancelled) return navigation;
    let summaryEntryId: string | undefined;
    if (options?.summary?.trim()) {
      const next = appendBranchSummaryEntry(this.entries, this.leafId, options);
      this.entries = next.entries;
      this.leafId = next.leafId;
      summaryEntryId = next.summaryEntryId;
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

  getRepoState(): SessionRepoState {
    return cloneSessionRepoState(this.repoState);
  }

  recordRepoRead(path: string, lineCount: number): void {
    this.repoState = recordSessionRepoRead(this.repoState, path, lineCount, this.budgetMetrics.totalTurns + 1);
    this.save();
  }

  recordRepoEdit(path: string, kind: "write" | "edit"): void {
    this.repoState = recordSessionRepoEdit(this.repoState, path, kind, this.budgetMetrics.totalTurns + 1);
    this.save();
  }

  recordRepoSearch(tool: SessionRepoState["recentSearches"][number]["tool"], query: string, hits: string[]): void {
    this.repoState = recordSessionRepoSearch(this.repoState, tool, query, hits, this.budgetMetrics.totalTurns + 1);
    this.save();
  }

  recordVerification(label: string, status: "pass" | "fail", detail = ""): void {
    this.repoState = recordSessionVerification(this.repoState, label, status, detail, this.budgetMetrics.totalTurns + 1);
    this.save();
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
    systemPromptTokens?: number;
    replayInputTokens?: number;
    stateCarrierTokens?: number;
    transientContextTokens?: number;
    visibleOutputTokens?: number;
    hiddenOutputTokens?: number;
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
    if (options.systemPromptTokens) this.budgetMetrics.systemPromptTokens += options.systemPromptTokens;
    if (options.replayInputTokens) this.budgetMetrics.replayInputTokens += options.replayInputTokens;
    if (options.stateCarrierTokens) this.budgetMetrics.stateCarrierTokens += options.stateCarrierTokens;
    if (options.transientContextTokens) this.budgetMetrics.transientContextTokens += options.transientContextTokens;
    if (options.visibleOutputTokens) this.budgetMetrics.visibleOutputTokens += options.visibleOutputTokens;
    if (options.hiddenOutputTokens) this.budgetMetrics.hiddenOutputTokens += options.hiddenOutputTokens;
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
    const reset = createResetSessionMetrics();
    this.budgetMetrics = reset.budgetMetrics;
    this.repoState = reset.repoState;
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
      repoState: this.repoState,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
    });
  }

  static load(id: string): Session | null {
    const data = loadSessionData(id);
    if (!data) return null;
    const session = new Session(data.id);
    session.name = data.name?.trim() || createDefaultSessionName();
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
    session.repoState = data.repoState ?? createEmptySessionRepoState();
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
    forked.repoState = cloneSessionRepoState(this.repoState);
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
