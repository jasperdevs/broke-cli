import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { Session } from "./session.js";
import { getSettings } from "./config.js";

function defaultSessionDir(cwd = process.cwd()): string {
  const configured = getSettings().sessionDir?.trim();
  if (!configured) return join(homedir(), ".brokecli", "sessions");
  return resolve(cwd, configured);
}

function sessionPath(idOrPath: string, cwd = process.cwd(), sessionDir?: string): string {
  if (idOrPath.endsWith(".json")) return resolve(idOrPath);
  return join(sessionDir ?? defaultSessionDir(cwd), `${idOrPath}.json`);
}

export class SessionManager {
  private readonly cwd: string;
  private readonly sessionDir: string;
  private readonly persisted: boolean;
  private session: Session;
  private sessionFile?: string;

  private constructor(cwd: string, session: Session, persisted: boolean, sessionFile?: string, sessionDir?: string) {
    this.cwd = cwd;
    this.session = session;
    this.persisted = persisted;
    this.sessionFile = sessionFile;
    this.sessionDir = sessionDir ?? defaultSessionDir(cwd);
  }

  static create(cwd = process.cwd(), sessionDir?: string): SessionManager {
    return new SessionManager(cwd, new Session(), true, undefined, sessionDir);
  }

  static inMemory(cwd = process.cwd()): SessionManager {
    return new SessionManager(cwd, new Session(), false, undefined, "");
  }

  static open(idOrPath: string, sessionDir?: string, cwdOverride?: string): SessionManager {
    const cwd = cwdOverride ?? process.cwd();
    const file = sessionPath(idOrPath, cwd, sessionDir);
    const baseId = file.endsWith(".json") ? file.slice(file.lastIndexOf("\\") + 1).replace(/\.json$/i, "") : idOrPath;
    const session = Session.load(baseId) ?? new Session(baseId);
    return new SessionManager(cwd, session, true, file, sessionDir);
  }

  static continueRecent(cwd = process.cwd(), sessionDir?: string): SessionManager {
    const all = existsSync(sessionDir ?? defaultSessionDir(cwd))
      ? readdirSync(sessionDir ?? defaultSessionDir(cwd))
          .filter((file) => file.endsWith(".json"))
          .map((file) => Session.load(file.replace(/\.json$/i, "")))
          .filter((session): session is Session => !!session && session.getCwd() === cwd)
          .sort((a, b) => b.getUpdatedAt() - a.getUpdatedAt())
      : [];
    if (all.length === 0) return SessionManager.create(cwd, sessionDir);
    return new SessionManager(cwd, all[0], true, sessionPath(all[0].getId(), cwd, sessionDir), sessionDir);
  }

  static forkFrom(idOrPath: string, targetCwd = process.cwd(), sessionDir?: string): SessionManager {
    const source = SessionManager.open(idOrPath, sessionDir, targetCwd).getSession();
    const forked = source.fork();
    return new SessionManager(targetCwd, forked, true, undefined, sessionDir);
  }

  static async list(cwd = process.cwd(), sessionDir?: string): Promise<Array<{
    id: string;
    cwd: string;
    model: string;
    cost: number;
    updatedAt: number;
    messageCount: number;
    preview: string;
  }>> {
    return Session.listRecent(100, "", cwd);
  }

  static async listAll(cwd = process.cwd(), sessionDir?: string): Promise<Array<{
    id: string;
    cwd: string;
    model: string;
    cost: number;
    updatedAt: number;
    messageCount: number;
    preview: string;
  }>> {
    const dir = sessionDir ?? defaultSessionDir(cwd);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
    return files
      .map((file) => Session.load(file.replace(/\.json$/i, "")))
      .filter((session): session is Session => !!session)
      .map((session) => ({
        id: session.getId(),
        cwd: session.getCwd(),
        model: `${session.getProvider()}/${session.getModel()}`,
        cost: session.getTotalCost(),
        updatedAt: session.getUpdatedAt(),
        messageCount: session.getMessages().length,
        preview: session.getMessages().find((message) => message.role === "user")?.content.split(/\r?\n/)[0]?.slice(0, 120) ?? "",
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(): Session {
    return this.session;
  }

  getSessionFile(): string | undefined {
    return this.sessionFile;
  }

  setSessionFile(file: string | undefined): void {
    this.sessionFile = file;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  getCwd(): string {
    return this.cwd;
  }

  isPersisted(): boolean {
    return this.persisted;
  }

  resetLeaf(): void {
    const session = new Session(this.session.getId());
    for (const message of this.session.getMessages()) session.addMessage(message.role, message.content, message.images);
    this.session = session;
  }

  deleteCurrentSession(): void {
    if (!this.sessionFile || !existsSync(this.sessionFile)) return;
    rmSync(this.sessionFile, { force: true });
  }

  ensureSessionDir(): void {
    if (!this.persisted) return;
    mkdirSync(this.sessionDir, { recursive: true });
  }
}
