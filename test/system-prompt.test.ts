import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildTaskExecutionAddendum } from "../src/core/context.js";

describe("system prompt", () => {
  it("explicitly allows benign non-coding requests instead of refusing them", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off");

    expect(prompt).toContain("Never refuse a benign user request just because it is not code.");
    expect(prompt).toContain("writing, explanation, brainstorming, planning, or general help");
  });

  it("forbids exposing raw tool protocol text to the user", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off");

    expect(prompt).toContain("Never expose raw tool calls");
    expect(prompt).toContain("Never print pseudo-tool calls");
    expect(prompt).toContain("do not fake it");
  });

  it("tells the agent to keep required long-running services alive for verification", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off");

    expect(prompt).toContain("long-running process");
    expect(prompt).toContain("leave it running");
    expect(prompt).toContain("nohup");
    expect(prompt).toContain("do not rely on plain `&`");
  });

  it("uses a much smaller lightweight prompt for casual turns", () => {
    const fullPrompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "full");
    const casualPrompt = buildSystemPrompt(process.cwd(), "openai", "build", "off", "casual");

    expect(casualPrompt).toContain("This is a lightweight casual turn.");
    expect(casualPrompt).not.toContain("<tool-tips>");
    expect(casualPrompt).not.toContain("--- AGENTS.md ---");
    expect(casualPrompt.length).toBeLessThan(fullPrompt.length);
  });

  it("does not advertise tools that are not registered in the normal runtime", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "off");

    expect(prompt).not.toContain("askUser");
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

  it("does not add server rules for ordinary file edits", () => {
    expect(buildTaskExecutionAddendum("Rename this setting and update the docs")).toBe("");
  });
});
