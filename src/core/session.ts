import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ContextOptimizer } from "./context-optimizer.js";
import { getSettings } from "./config.js";

const SESSIONS_DIR = join(homedir(), ".brokecli", "sessions");

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  images?: Array<{ mimeType: string; data: string }>;
}

interface SessionData {
  id: string;
  cwd: string;
  provider: string;
  model: string;
  messages: Message[];
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

export class Session {
  private id: string;
  private messages: Message[] = [];
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
    this.id = id ?? new Date().toISOString().replace(/[:.]/g, "-");
  }

  getId(): string { return this.id; }

  getContextOptimizer(): ContextOptimizer {
    return this.contextOptimizer;
  }

  setProviderModel(provider: string, model: string): void {
    this.provider = provider;
    this.model = model;
  }

  addMessage(role: Message["role"], content: string, images?: Array<{ mimeType: string; data: string }>): void {
    this.messages.push({ role, content, timestamp: Date.now(), images });
    this.save();
  }

  getMessages(): Message[] {
    return this.messages;
  }

  getChatMessages(): Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }> {
    return this.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, images: m.images }));
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
    this.messages = messages.map((message) => ({
      role: message.role,
      content: message.content,
      images: message.images,
      timestamp: Date.now(),
    }));
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
    this.messages = [];
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
      mkdirSync(SESSIONS_DIR, { recursive: true });
      const data: SessionData = {
        id: this.id,
        cwd: this.cwd,
        provider: this.provider,
        model: this.model,
        messages: this.messages,
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        totalCost: this.totalCost,
        budgetMetrics: this.budgetMetrics,
        createdAt: this.createdAt,
        updatedAt: Date.now(),
      };
      writeFileSync(join(SESSIONS_DIR, `${this.id}.json`), JSON.stringify(data), "utf-8");
    } catch {
      // silently fail - sessions are optional
    }
  }

  static load(id: string): Session | null {
    try {
      const path = join(SESSIONS_DIR, `${id}.json`);
      const raw = readFileSync(path, "utf-8");
      const data: SessionData = JSON.parse(raw);
      const session = new Session(data.id);
      session.messages = data.messages;
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

  /** Fork this session — creates a copy with a new ID, preserving full history */
  fork(): Session {
    const forked = new Session();
    forked.messages = [...this.messages];
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
      if (!existsSync(SESSIONS_DIR)) return [];
      const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
      const normalized = query.trim().toLowerCase();
      const sessions = files.map((f) => {
        try {
          const raw = readFileSync(join(SESSIONS_DIR, f), "utf-8");
          const data: SessionData = JSON.parse(raw);
          const preview = data.messages.find((msg) => msg.role === "user")?.content?.split(/\r?\n/)[0]?.slice(0, 120) ?? "";
          return {
            id: data.id,
            cwd: data.cwd,
            model: `${data.provider}/${data.model}`,
            cost: data.totalCost,
            updatedAt: data.updatedAt,
            messageCount: data.messages.length,
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
