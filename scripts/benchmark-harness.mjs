import { runFixedBenchmarkSuite, renderFixedBenchmarkReport } from "../dist/benchmark-harness.mjs";

function parseArgs(argv) {
  const parsed = {
    suite: "fixed",
    provider: undefined,
    model: undefined,
    mode: "build",
    maxTurns: undefined,
    json: false,
    keepWorkspaces: false,
    taskIds: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--provider" && next) {
      parsed.provider = next;
      i += 1;
    } else if (arg === "--suite" && next) {
      parsed.suite = next;
      i += 1;
    } else if (arg === "--model" && next) {
      parsed.model = next;
      i += 1;
    } else if (arg === "--mode" && next) {
      parsed.mode = next;
      i += 1;
    } else if (arg === "--max-turns" && next) {
      parsed.maxTurns = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--task" && next) {
      parsed.taskIds.push(next);
      i += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--keep-workspaces") {
      parsed.keepWorkspaces = true;
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runFixedBenchmarkSuite({
    suiteName: args.suite,
    provider: args.provider,
    model: args.model,
    mode: args.mode,
    maxTurns: args.maxTurns,
    keepWorkspaces: args.keepWorkspaces,
    taskIds: args.taskIds.length > 0 ? args.taskIds : undefined,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(renderFixedBenchmarkReport(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
