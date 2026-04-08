import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildTaskExecutionAddendum } from "../src/core/context.js";

describe("system prompt", () => {
  it("keeps the lean profile short and direct", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "lean");

    expect(prompt).toContain("You are a terminal coding assistant.");
    expect(prompt).toContain("Answer directly.");
    expect(prompt).toContain("Keep the final answer short and factual.");
    expect(prompt).not.toContain("--- AGENTS.md ---");
    expect(prompt).not.toContain("<autonomy>");
  });

  it("keeps the edit profile patch-oriented and brief", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "edit");

    expect(prompt).toContain("inspect first, then make the smallest correct change");
    expect(prompt).toContain("Prefer editFile for existing files");
    expect(prompt).toContain("reply in at most 2 short lines");
  });

  it("uses a much smaller lightweight prompt for casual turns", () => {
    const leanPrompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "lean");
    const casualPrompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "casual");

    expect(casualPrompt).toContain("Casual turn: answer naturally in 1-2 short sentences.");
    expect(casualPrompt).not.toContain("--- AGENTS.md ---");
    expect(casualPrompt.length).toBeLessThan(leanPrompt.length);
  });

  it("keeps full profile richer than lean", () => {
    const fullPrompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "full");
    const leanPrompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "lean");

    expect(fullPrompt).toContain("<autonomy>");
    expect(fullPrompt.length).toBeGreaterThan(leanPrompt.length);
  });

  it("adds detached-launch rules for server tasks", () => {
    const addendum = buildTaskExecutionAddendum("Create and run a server on port 3000 with one endpoint");

    expect(addendum).toContain("Server task rule");
    expect(addendum).toContain("nohup");
    expect(addendum).toContain("Do not rely on plain `&`");
    expect(addendum).toContain("PID still exists");
    expect(addendum).toContain("setsid");
    expect(addendum).toContain("JSON number");
    expect(addendum).toContain("reject negative integers");
    expect(addendum).toContain("curl");
  });

  it("adds exact git-recovery rules for lost-change tasks", () => {
    const addendum = buildTaskExecutionAddendum(
      "I checked out master and can't find my changes. Please recover them and merge them into master.",
    );

    expect(addendum).toContain("Git recovery rule");
    expect(addendum).toContain("reflog");
    expect(addendum).toContain("Do not manually reconstruct lost files");
    expect(addendum).toContain("preserve the recovered commit's file contents exactly");
  });

  it("adds nginx scope rules for logging and rate-limit tasks", () => {
    const addendum = buildTaskExecutionAddendum(
      "Set up an Nginx server with request logging, rate limiting, and a conf.d site config.",
    );

    expect(addendum).toContain("Nginx rule");
    expect(addendum).toContain("log_format");
    expect(addendum).toContain("limit_req_zone");
    expect(addendum).toContain("nginx.conf");
    expect(addendum).toContain("literal directives");
    expect(addendum).toContain("rate=10r/s");
    expect(addendum).toContain("exact plain-text content");
    expect(addendum).toContain("burst=10");
  });

  it("adds exact-content rules when literal output text is specified", () => {
    const addendum = buildTaskExecutionAddendum(
      'Create index.html with the content: "Welcome to the benchmark webserver"',
    );

    expect(addendum).toContain("Exact-content rule");
    expect(addendum).toContain("exact text");
    expect(addendum).toContain("wrapper markup");
  });

  it("adds exact-preservation rules for data conversion tasks", () => {
    const addendum = buildTaskExecutionAddendum(
      "Convert /app/data.csv into /app/data.parquet without changing the data.",
    );

    expect(addendum).toContain("Data-conversion rule");
    expect(addendum).toContain("values, and inferred column dtypes exactly");
    expect(addendum).toContain("pandas");
    expect(addendum).toContain("Node parquet libraries");
    expect(addendum).toContain("install the minimal Python packages");
    expect(addendum).toContain("uv");
    expect(addendum).toContain("write that same dataframe directly");
    expect(addendum).toContain("assert_frame_equal");
    expect(addendum).toContain("df = pd.read_csv(source)");
    expect(addendum).toContain("Do not fall back to JavaScript parquet libraries");
    expect(addendum).toContain("verify the records match");
  });

  it("adds direct-edit rules for explicit single-file patches", () => {
    const addendum = buildTaskExecutionAddendum(
      'Update src/app.js so greeting() returns exactly "Hello there!" and do not touch any other files.',
    );

    expect(addendum).toContain("Direct-edit rule");
    expect(addendum).toContain("read only the named file");
    expect(addendum).toContain("Do not inspect unrelated files");
    expect(addendum).toContain("Do not inspect unrelated files, run tests, or use shell");
  });

  it("adds rename rules for repo-wide symbol renames", () => {
    const addendum = buildTaskExecutionAddendum(
      "Rename sumNumbers to addNumbers across this repo and keep behavior unchanged everywhere.",
    );

    expect(addendum).toContain("Rename rule");
    expect(addendum).toContain("do one search for the old symbol");
    expect(addendum).toContain("patch only the matches");
    expect(addendum).toContain("Do not run shell");
  });

  it("adds test-writing rules that avoid unnecessary test runs", () => {
    const addendum = buildTaskExecutionAddendum(
      "Write node:test coverage in test/flags.test.js for src/flags.js.",
    );

    expect(addendum).toContain("Test-writing rule");
    expect(addendum).toContain("read the source file once");
    expect(addendum).toContain("Do not run tests or shell");
  });

  it("adds read-only answer rules for exploration prompts", () => {
    const addendum = buildTaskExecutionAddendum(
      "Without changing any files, tell me which file defines parseConfig and which file imports it. Answer in one sentence.",
    );

    expect(addendum).toContain("Read-only answer rule");
    expect(addendum).toContain("smallest lookup");
    expect(addendum).toContain("Do not edit files");
  });

  it("does not add server rules for ordinary file edits", () => {
    expect(buildTaskExecutionAddendum("Rename this setting and update the docs")).toBe("");
  });
});
