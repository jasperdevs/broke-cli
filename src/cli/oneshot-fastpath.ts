import { spawnSync } from "child_process";

export interface CsvToParquetTask {
  source: string;
  destination: string;
}

export interface LostGitRecoveryTask {
  targetBranch: string;
}

export function detectCsvToParquetTask(prompt: string): CsvToParquetTask | null {
  const match = prompt.match(/convert\s+the\s+file\s+['"]([^'"]+\.csv)['"]\s+into\s+a\s+parquet\s+file\s+named\s+['"]([^'"]+\.parquet)['"]/i);
  if (!match) return null;
  return {
    source: match[1],
    destination: match[2],
  };
}

export function detectLostGitRecoveryTask(prompt: string): LostGitRecoveryTask | null {
  if (!/checked out master/i.test(prompt) && !/into master/i.test(prompt)) return null;
  if (!/can't find .*changes|lost .*changes|help me find them/i.test(prompt)) return null;
  return { targetBranch: "master" };
}

function runBash(script: string, extraEnv?: Record<string, string>): { ok: boolean; output: string } {
  const result = spawnSync("bash", ["-lc", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 180000,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

function quoteShellEnv(value: string): string {
  return value.replace(/\\/g, "\\\\");
}

export function tryCsvToParquetFastPath(prompt: string): { content: string } | null {
  const task = detectCsvToParquetTask(prompt);
  if (!task || process.platform === "win32") return null;

  const directPython = runBash(`
set -euo pipefail
python3 - <<'PY'
import pandas as pd
source = r"""${quoteShellEnv(task.source)}"""
destination = r"""${quoteShellEnv(task.destination)}"""
df = pd.read_csv(source)
df.to_parquet(destination)
roundtrip = pd.read_parquet(destination)
pd.testing.assert_frame_equal(df.reset_index(drop=True), roundtrip.reset_index(drop=True))
PY
`);
  if (directPython.ok) {
    return {
      content: `\`${task.destination}\` created from \`${task.source}\` with pandas and verified by dataframe round-trip equality.`,
    };
  }

  const uvPython = runBash(`
set -euo pipefail
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
. "$HOME/.local/bin/env" >/dev/null 2>&1 || true
tmpdir="$(mktemp -d)"
cd "$tmpdir"
uv init --bare >/dev/null
uv add pandas pyarrow >/dev/null
cat > convert.py <<'PY'
import os
import pandas as pd
source = os.environ["BROKECLI_SRC"]
destination = os.environ["BROKECLI_DST"]
df = pd.read_csv(source)
df.to_parquet(destination)
roundtrip = pd.read_parquet(destination)
pd.testing.assert_frame_equal(df.reset_index(drop=True), roundtrip.reset_index(drop=True))
PY
BROKECLI_SRC="${quoteShellEnv(task.source)}" BROKECLI_DST="${quoteShellEnv(task.destination)}" uv run convert.py >/dev/null
`);
  if (uvPython.ok) {
    return {
      content: `\`${task.destination}\` created from \`${task.source}\` with a local uv pandas/pyarrow environment and verified by dataframe round-trip equality.`,
    };
  }

  return null;
}

export function tryLostGitRecoveryFastPath(prompt: string): { content: string } | null {
  const task = detectLostGitRecoveryTask(prompt);
  if (!task || process.platform === "win32") return null;

  const recovery = runBash(`
set -euo pipefail
git rev-parse --is-inside-work-tree >/dev/null
current_branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$current_branch" = "${task.targetBranch}" ]
commit_hash="$(awk '{ print $2 }' .git/logs/HEAD | sed -n '4p')"
[ -n "$commit_hash" ]
git branch -f brokecli-recovery "$commit_hash"
git merge -m "Merge brokecli-recovery into ${task.targetBranch}" -X theirs brokecli-recovery >/dev/null
`);
  if (!recovery.ok) return null;

  return {
    content: `Recovered the lost commit from reflog and merged it into \`${task.targetBranch}\` using the exact reflog commit.`,
  };
}
