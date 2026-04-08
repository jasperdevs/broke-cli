import { readFile, readdir } from "fs/promises";
import { join, relative } from "path";

const SNAPSHOT_SKIP_PREFIXES = [".omx/", ".tmp/", "dist/", "coverage/", "node_modules/"];

function shouldSnapshotPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return !SNAPSHOT_SKIP_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export async function collectWorkspaceSnapshot(workspace: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const relativePath = relative(workspace, fullPath).replace(/\\/g, "/");
      if (!shouldSnapshotPath(relativePath)) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      snapshot.set(relativePath, await readFile(fullPath, "utf8"));
    }
  }
  await walk(workspace);
  return snapshot;
}
