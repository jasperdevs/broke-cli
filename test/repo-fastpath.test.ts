import { mkdtemp, mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";
import { tryRepoTaskFastPath } from "../src/cli/repo-fastpath.js";

const workspaces: string[] = [];

async function createWorkspace(files: Record<string, string>): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "brokecli-fastpath-"));
  workspaces.push(workspace);
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const fullPath = join(workspace, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }));
  return workspace;
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(async (workspace) => {
    await import("fs/promises").then(({ rm }) => rm(workspace, { recursive: true, force: true }));
  }));
});

describe("repo task fast path", () => {
  it("renames an exact symbol across the repo without invoking a model", async () => {
    const workspace = await createWorkspace({
      "src/math.js": "export function sumNumbers(a, b) { return a + b; }\n",
      "src/index.js": "import { sumNumbers } from './math.js';\nexport const total = sumNumbers(1, 2);\n",
    });
    const session = new Session(`fastpath-rename-${Date.now()}`);

    const result = await tryRepoTaskFastPath({
      root: workspace,
      prompt: "Rename sumNumbers to addNumbers across this repo and keep behavior unchanged.",
      session,
    });

    expect(result?.label).toBe("repoRenameFastPath");
    expect(await readFile(join(workspace, "src/math.js"), "utf8")).toContain("addNumbers");
    expect(await readFile(join(workspace, "src/index.js"), "utf8")).toContain("addNumbers");
    expect(session.getRepoState().recentEdits.map((entry) => entry.path)).toEqual(expect.arrayContaining(["src/index.js", "src/math.js"]));
  });

  it("answers definition/import questions directly from the repo", async () => {
    const workspace = await createWorkspace({
      "src/config.js": "export function parseConfig(text) { return text; }\n",
      "src/cli.js": "import { parseConfig } from './config.js';\nexport const load = parseConfig;\n",
    });

    const result = await tryRepoTaskFastPath({
      root: workspace,
      prompt: "Without changing any files, tell me which file defines parseConfig and which file imports it. Answer in one sentence.",
    });

    expect(result?.content).toContain("src/config.js defines parseConfig");
    expect(result?.content).toContain("src/cli.js import it");
  });

  it("answers import-only follow-up questions directly from the repo", async () => {
    const workspace = await createWorkspace({
      "src/config.js": "export function parseSettings(text) { return text; }\n",
      "src/cli.js": "import { parseSettings } from './config.js';\nexport const load = parseSettings;\n",
      "src/ui.js": "import { parseSettings } from './config.js';\nexport const preview = parseSettings;\n",
    });

    const result = await tryRepoTaskFastPath({
      root: workspace,
      prompt: "Without changing any files, answer in one sentence which files now import parseSettings.",
    });

    expect(result?.label).toBe("importQueryFastPath");
    expect(result?.content).toContain("src/cli.js");
    expect(result?.content).toContain("src/ui.js");
  });

  it("ignores nested node_modules while renaming", async () => {
    const workspace = await createWorkspace({
      "src/math.js": "export function sumNumbers(a, b) { return a + b; }\n",
      "packages/demo/node_modules/pkg/index.js": "export const sumNumbers = () => 1;\n",
      "src/generated/client.js": "export const sumNumbers = () => 2;\n",
      "README.md": "sumNumbers is documented here.\n",
      "package.json": "{ \"name\": \"sumNumbers-demo\" }\n",
    });

    await tryRepoTaskFastPath({
      root: workspace,
      prompt: "Rename sumNumbers to addNumbers across this repo and keep behavior unchanged.",
    });

    expect(await readFile(join(workspace, "src/math.js"), "utf8")).toContain("addNumbers");
    expect(await readFile(join(workspace, "packages/demo/node_modules/pkg/index.js"), "utf8")).toContain("sumNumbers");
    expect(await readFile(join(workspace, "src/generated/client.js"), "utf8")).toContain("sumNumbers");
    expect(await readFile(join(workspace, "README.md"), "utf8")).toContain("sumNumbers");
    expect(await readFile(join(workspace, "package.json"), "utf8")).toContain("sumNumbers-demo");
  });
});
