/** A cached prompt-response pair */
export interface CacheEntry {
  key: string;
  response: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

/** Interface for the cache store (SQLite-backed) */
export interface CacheStore {
  get(key: string): CacheEntry | null;
  set(entry: CacheEntry): void;
  delete(key: string): void;
  clear(): void;
  stats(): { entries: number; hits: number; misses: number };
}
