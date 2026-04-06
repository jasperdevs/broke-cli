import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SESSIONS_DIR = join(homedir(), ".brokecli", "sessions");

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
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
  createdAt: number;
  updatedAt: number;
}

export class Session {
  private id: string;
  private messages: Message[] = [];
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCost = 0;
  private cwd = process.cwd();
  private provider = "";
  private model = "";
  private createdAt = Date.now();

  constructor(id?: string) {
    this.id = id ?? new Date().toISOString().replace(/[:.]/g, "-");
  }

  getId(): string { return this.id; }

  setProviderModel(provider: string, model: string): void {
    this.provider = provider;
    this.model = model;
  }

  addMessage(role: Message["role"], content: string): void {
    this.messages.push({ role, content, timestamp: Date.now() });
    this.save();
  }

  getMessages(): Message[] {
    return this.messages;
  }

  getChatMessages(): Array<{ role: "user" | "assistant"; content: string }> {
    return this.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
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

  getTotalCost(): number {
    return this.totalCost;
  }

  clear(): void {
    this.messages = [];
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCost = 0;
    this.save();
  }

  private save(): void {
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
      session.cwd = data.cwd;
      session.provider = data.provider;
      session.model = data.model;
      session.createdAt = data.createdAt;
      return session;
    } catch {
      return null;
    }
  }

  static listRecent(limit = 10): Array<{ id: string; cwd: string; model: string; cost: number; updatedAt: number; messageCount: number }> {
    try {
      if (!existsSync(SESSIONS_DIR)) return [];
      const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
      const sessions = files.map((f) => {
        try {
          const raw = readFileSync(join(SESSIONS_DIR, f), "utf-8");
          const data: SessionData = JSON.parse(raw);
          return {
            id: data.id,
            cwd: data.cwd,
            model: `${data.provider}/${data.model}`,
            cost: data.totalCost,
            updatedAt: data.updatedAt,
            messageCount: data.messages.length,
          };
        } catch {
          return null;
        }
      }).filter(Boolean) as Array<{ id: string; cwd: string; model: string; cost: number; updatedAt: number; messageCount: number }>;

      return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    } catch {
      return [];
    }
  }
}
