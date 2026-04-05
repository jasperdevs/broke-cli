import type { Message } from "../context/types.js";
import type { TokenUsage } from "../providers/types.js";

/** A single turn in a conversation (user prompt + assistant response) */
export interface Turn {
  id: string;
  userMessage: Message;
  assistantMessage: Message;
  toolMessages: Message[];
  provider: string;
  model: string;
  usage: TokenUsage;
  routingReason: string;
  timestamp: Date;
}

/** A session represents a conversation with branching support */
export interface Session {
  id: string;
  parentId?: string;
  title?: string;
  workingDirectory: string;
  createdAt: Date;
  updatedAt: Date;
  turns: Turn[];
  metadata: Record<string, unknown>;
}

/** Lightweight session info for listing */
export interface SessionSummary {
  id: string;
  title?: string;
  workingDirectory: string;
  turnCount: number;
  totalCost: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Interface for session persistence */
export interface SessionStore {
  create(session: Omit<Session, "id" | "createdAt" | "updatedAt">): Session;
  get(id: string): Session | null;
  list(workingDirectory?: string): SessionSummary[];
  addTurn(sessionId: string, turn: Turn): void;
  update(id: string, updates: Partial<Pick<Session, "title" | "metadata">>): void;
  fork(sessionId: string, atTurnIndex?: number): Session;
  delete(id: string): void;
  getMostRecent(workingDirectory?: string): Session | null;
}
