import { execSync } from "child_process";

let lastCheckpointHash: string | null = null;

function isGitRepo(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function createCheckpoint(): boolean {
  if (!isGitRepo()) return false;
  try {
    // Stage all changes and create a checkpoint commit
    const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
    if (!status) return false; // nothing to checkpoint

    execSync("git add -A", { stdio: "pipe" });
    execSync('git commit -m "checkpoint before tool changes" --no-verify', {
      encoding: "utf-8",
      stdio: "pipe",
    });
    lastCheckpointHash = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    return true;
  } catch {
    return false;
  }
}

export function undoLastCheckpoint(): { success: boolean; message: string } {
  if (!lastCheckpointHash) {
    return { success: false, message: "No checkpoint to undo." };
  }
  if (!isGitRepo()) {
    return { success: false, message: "Not a git repository." };
  }
  try {
    execSync(`git reset --soft HEAD~1`, { stdio: "pipe" });
    execSync("git restore --staged .", { stdio: "pipe" });
    const msg = `Undone checkpoint ${lastCheckpointHash.slice(0, 7)}`;
    lastCheckpointHash = null;
    return { success: true, message: msg };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export function getGitInfo(): { branch: string; dirty: boolean } | null {
  if (!isGitRepo()) return null;
  try {
    const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
    const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
    return { branch, dirty: status.length > 0 };
  } catch {
    return null;
  }
}
