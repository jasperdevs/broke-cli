import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface ProjectRecord {
  cwd: string;
  lastAccessed: number;
  lastInstruction: string;
  sessionId: string;
}

const PROJECTS_DIR = join(homedir(), ".brokecli");
const PROJECTS_FILE = join(PROJECTS_DIR, "projects.json");

function readProjects(): ProjectRecord[] {
  if (!existsSync(PROJECTS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(PROJECTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeProjects(projects: ProjectRecord[]): void {
  try {
    mkdirSync(PROJECTS_DIR, { recursive: true });
    writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
  } catch {
    // ignore project persistence failures
  }
}

export function touchProject(cwd: string, sessionId: string, lastInstruction: string): void {
  const projects = readProjects();
  const next = projects.filter((entry) => entry.cwd !== cwd);
  next.push({
    cwd,
    lastAccessed: Date.now(),
    lastInstruction,
    sessionId,
  });
  next.sort((a, b) => b.lastAccessed - a.lastAccessed);
  writeProjects(next.slice(0, 200));
}

export function listProjects(limit = 20, query = ""): ProjectRecord[] {
  const normalized = query.trim().toLowerCase();
  const projects = readProjects().sort((a, b) => b.lastAccessed - a.lastAccessed);
  if (!normalized) return projects.slice(0, limit);
  return projects
    .filter((entry) =>
      entry.cwd.toLowerCase().includes(normalized)
      || entry.lastInstruction.toLowerCase().includes(normalized),
    )
    .slice(0, limit);
}
