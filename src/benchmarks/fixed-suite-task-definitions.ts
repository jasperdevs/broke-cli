import { execFile as execFileCb } from "child_process";
import { readFile, readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { promisify } from "util";
import { pathToFileURL } from "url";

const execFile = promisify(execFileCb);

export type TaskCategory = "read_modify" | "multi_file_refactor" | "bug_fix" | "test_writing" | "repo_exploration";
export type TaskVerification = { success: boolean; message: string };

export type FixedBenchmarkTask = {
  id: TaskCategory;
  description: string;
  prompt: string;
  retryPrompt: string;
  files: Record<string, string>;
  verify: (workspace: string, assistantText: string, initialSnapshot: Map<string, string>) => Promise<TaskVerification>;
};

async function collectWorkspaceSnapshot(workspace: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      snapshot.set(relative(workspace, fullPath).replace(/\\/g, "/"), await readFile(fullPath, "utf8"));
    }
  }
  await walk(workspace);
  return snapshot;
}

async function importFresh<T>(filePath: string): Promise<T> {
  return import(`${pathToFileURL(filePath).href}?t=${Date.now()}`) as Promise<T>;
}

async function verifyNodeTest(workspace: string, relativeTestPath: string): Promise<void> {
  await execFile(process.execPath, ["--test", relativeTestPath], { cwd: workspace });
}

const FIXED_BENCHMARK_TASKS: FixedBenchmarkTask[] = [
  {
    id: "read_modify",
    description: "Read + modify a file",
    prompt: "Update src/app.js so greeting() returns exactly \"Hello there!\" and do not touch any other files.",
    retryPrompt: "The edit is incomplete. Fix the requested file so greeting() returns exactly \"Hello there!\".",
    files: {
      "src/app.js": "export function greeting() {\n  return \"Hello world\";\n}\n",
    },
    verify: async (workspace) => {
      const content = await readFile(join(workspace, "src/app.js"), "utf8");
      return content.includes('return "Hello there!";')
        ? { success: true, message: "src/app.js updated correctly" }
        : { success: false, message: "src/app.js does not return the expected string" };
    },
  },
  {
    id: "multi_file_refactor",
    description: "Rename a helper across multiple files",
    prompt: "Rename sumNumbers to addNumbers across this repo and keep behavior unchanged.",
    retryPrompt: "The rename is incomplete. Finish renaming sumNumbers to addNumbers everywhere without breaking behavior.",
    files: {
      "src/math.js": "export function sumNumbers(a, b) {\n  return a + b;\n}\n",
      "src/index.js": "import { sumNumbers } from \"./math.js\";\n\nexport function totalPair(x, y) {\n  return sumNumbers(x, y);\n}\n",
      "src/report.js": "import { totalPair } from \"./index.js\";\n\nexport const sampleTotal = totalPair(2, 3);\n",
    },
    verify: async (workspace) => {
      const [mathContent, indexContent] = await Promise.all([
        readFile(join(workspace, "src/math.js"), "utf8"),
        readFile(join(workspace, "src/index.js"), "utf8"),
      ]);
      if (mathContent.includes("sumNumbers") || indexContent.includes("sumNumbers")) {
        return { success: false, message: "sumNumbers still appears after the refactor" };
      }
      const imported = await importFresh<{ totalPair: (x: number, y: number) => number }>(join(workspace, "src/index.js"));
      return imported.totalPair(2, 3) === 5
        ? { success: true, message: "rename completed and behavior still works" }
        : { success: false, message: "refactor changed behavior" };
    },
  },
  {
    id: "bug_fix",
    description: "Fix a small logic bug",
    prompt: "Fix src/range.js so isWithinWindow includes the start and end values in the allowed range.",
    retryPrompt: "The range check is still wrong. Make isWithinWindow inclusive of both boundaries.",
    files: {
      "src/range.js": "export function isWithinWindow(value, start, end) {\n  return value > start && value < end;\n}\n",
    },
    verify: async (workspace) => {
      const imported = await importFresh<{ isWithinWindow: (value: number, start: number, end: number) => boolean }>(join(workspace, "src/range.js"));
      const ok = imported.isWithinWindow(1, 1, 3) && imported.isWithinWindow(3, 1, 3) && !imported.isWithinWindow(4, 1, 3);
      return ok
        ? { success: true, message: "boundary bug fixed" }
        : { success: false, message: "function still excludes one or both boundaries" };
    },
  },
  {
    id: "test_writing",
    description: "Write runnable tests",
    prompt: "Write node:test coverage in test/flags.test.js for src/flags.js. Cover value flags, boolean flags, and unknown input.",
    retryPrompt: "The test file is incomplete or failing. Update test/flags.test.js so it covers the requested cases and passes under node --test.",
    files: {
      "src/flags.js": "export function parseFlag(input) {\n  if (!input.startsWith(\"--\")) return null;\n  const [rawName, rawValue] = input.slice(2).split(\"=\");\n  if (!rawName) return null;\n  return rawValue === undefined ? { name: rawName, value: true } : { name: rawName, value: rawValue };\n}\n",
    },
    verify: async (workspace) => {
      const testPath = join(workspace, "test/flags.test.js");
      try {
        await stat(testPath);
      } catch {
        return { success: false, message: "test/flags.test.js was not created" };
      }
      try {
        await verifyNodeTest(workspace, "test/flags.test.js");
        return { success: true, message: "tests exist and pass under node --test" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, message: `node --test failed: ${message}` };
      }
    },
  },
  {
    id: "repo_exploration",
    description: "Explore a repo and answer a question without editing",
    prompt: "Without changing any files, tell me which file defines parseConfig and which file imports it. Answer in one sentence.",
    retryPrompt: "The answer was wrong or files changed. Answer in one sentence with the defining file and importing file, and do not edit anything.",
    files: {
      "src/config.js": "export function parseConfig(text) {\n  return text.trim().split(/\\n+/);\n}\n",
      "src/cli.js": "import { parseConfig } from \"./config.js\";\n\nexport function loadCliConfig(raw) {\n  return parseConfig(raw);\n}\n",
      "README.md": "# Demo repo\\n\\nThis repo loads CLI config from src/cli.js.\\n",
    },
    verify: async (workspace, assistantText, initialSnapshot) => {
      const currentSnapshot = await collectWorkspaceSnapshot(workspace);
      for (const [path, content] of initialSnapshot.entries()) {
        if (currentSnapshot.get(path) !== content) {
          return { success: false, message: `repo exploration edited ${path}` };
        }
      }
      const normalized = assistantText.replace(/\\/g, "/");
      const ok = normalized.includes("src/config.js") && normalized.includes("src/cli.js");
      return ok
        ? { success: true, message: "answer named the defining and importing files" }
        : { success: false, message: "answer did not mention both src/config.js and src/cli.js" };
    },
  },
];

export function getFixedBenchmarkTasks(): FixedBenchmarkTask[] {
  return FIXED_BENCHMARK_TASKS.map((task) => ({ ...task, files: { ...task.files } }));
}
