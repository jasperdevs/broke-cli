import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import { getSettings } from "./config.js";
import type { Message, SessionData, SessionEntry, SessionListItem } from "./session-types.js";

export function resolveSessionsDir(): string {
  const configured = getSettings().sessionDir?.trim();
  if (!configured) return join(homedir(), ".brokecli", "sessions");
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
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

function getMessagesForData(data: SessionData): Message[] {
  if (data.entries) {
    return getActiveEntries(data.entries, data.leafId ?? data.entries[data.entries.length - 1]?.id ?? null)
      .map(({ id: _id, parentId: _parentId, label: _label, labelTimestamp: _labelTimestamp, ...message }) => message);
  }
  return data.messages ?? [];
}

export function saveSessionData(data: SessionData): void {
  if (!getSettings().autoSaveSessions) return;
  try {
    const sessionsDir = resolveSessionsDir();
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, `${data.id}.json`), JSON.stringify(data), "utf-8");
  } catch {
    // silently fail - sessions are optional
  }
}

export function loadSessionData(id: string): SessionData | null {
  try {
    const raw = readFileSync(join(resolveSessionsDir(), `${id}.json`), "utf-8");
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export function listRecentSessions(limit = 10, query = "", cwd?: string): SessionListItem[] {
  if (!getSettings().autoSaveSessions) return [];
  try {
    const sessionsDir = resolveSessionsDir();
    if (!existsSync(sessionsDir)) return [];
    const files = readdirSync(sessionsDir).filter((file) => file.endsWith(".json"));
    const normalized = query.trim().toLowerCase();
    const sessions = files.map((file) => {
      try {
        const raw = readFileSync(join(sessionsDir, file), "utf-8");
        const data = JSON.parse(raw) as SessionData;
        const messages = getMessagesForData(data);
        const preview = messages.find((message) => message.role === "user")?.content?.split(/\r?\n/)[0]?.slice(0, 120) ?? "";
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
    }).filter(Boolean) as SessionListItem[];

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
