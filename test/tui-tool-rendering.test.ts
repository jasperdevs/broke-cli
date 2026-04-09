import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";

function makeApp(width = 96, height = 22) {
  const app = new App() as any;
  app.screen = {
    height,
    width,
    hasSidebar: false,
    mainWidth: width,
    sidebarWidth: 0,
    render: () => {},
    setCursor: () => {},
    hideCursor: () => {},
    forceRedraw: () => {},
  };
  return app;
}

describe("tool rendering detail", () => {
  it("uses terminal-native text states instead of checkmark/icon status glyphs", () => {
    const app = makeApp();
    app.addToolCall("readFile", "README.md", { path: "README.md" }, "call_read");
    let output = app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("[run]");
    expect(output).not.toContain("✔");
    expect(output).not.toContain("✖");

    app.addToolResult("readFile", "ok", false, "4 lines", "call_read");
    output = app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("[done]");
    expect(output).not.toContain("✔");
  });

  it("persists completed tool activity in the turn transcript after the next user starts", () => {
    const app = makeApp();
    app.addMessage("user", "read README.md");
    app.addToolCall("readFile", "README.md", { path: "README.md" }, "call_read");
    app.addToolResult("readFile", "ok", false, "4 lines", "call_read");
    app.addMessage("assistant", "Read README.md.");

    app.addMessage("user", "next prompt");

    const output = app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("read README.md");
    expect(output).toContain("[done]");
    expect(output).toContain("4 lines");
    expect(output).toContain("next prompt");
  });

  it("shows specific live argument summaries for file writes", () => {
    const app = makeApp();
    app.addToolCall("writeFile", "...", undefined, "call_write");
    app.updateToolCallArgs("writeFile", "index.html", { path: "index.html", content: "<html>\n<body>\nhi\n</body>\n</html>" }, "call_write");
    const output = app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("write index.html");
    expect(output).toContain("5 lines");
    expect(output).toContain("32 bytes");
  });

  it("shows specific live argument summaries for reads and searches", () => {
    const app = makeApp();
    app.addToolCall("readFile", "...", undefined, "call_read");
    app.updateToolCallArgs("readFile", "README.md:11-30", { path: "README.md", offset: 10, limit: 20, mode: "minimal" }, "call_read");
    app.addToolCall("grep", "...", undefined, "call_grep");
    app.updateToolCallArgs("grep", "todo in src", { pattern: "todo", path: "src" }, "call_grep");
    const output = app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("read README.md:11-30");
    expect(output).toContain("lines 11-30");
    expect(output).toContain("minimal");
    expect(output).toContain("grep todo in src");
    expect(output).toContain("pattern: todo");
  });

  it("shows specific result summaries for writes and edits", () => {
    const app = makeApp();
    app.addToolCall("writeFile", "index.html", undefined, "call_write");
    app.updateToolCallArgs("writeFile", "index.html", { path: "index.html", content: "<html>\n<body>\nhi\n</body>\n</html>" }, "call_write");
    app.addToolResult("writeFile", "ok", false, "5 lines · 32 bytes written", "call_write");
    app.addToolCall("editFile", "src/app.ts", undefined, "call_edit");
    app.updateToolCallArgs("editFile", "src/app.ts", { path: "src/app.ts", old_string: "old\nline", new_string: "new\nline\nhere" }, "call_edit");
    app.addToolResult("editFile", "ok", false, "2 -> 3 lines replaced", "call_edit");
    const output = app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("5 lines · 32 bytes written");
    expect(output).toContain("2 -> 3 lines replaced");
  });

  it("labels opaque native file deltas as observed workspace changes", () => {
    const app = makeApp();
    app.addToolCall("workspaceEdit", "index.html", { path: "index.html" }, "observed_index");
    app.addToolResult("workspaceEdit", "ok", false, "observed on disk", "observed_index");

    const output = app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("changed index.html");
    expect(output).toContain("observed on disk");
    expect(output).not.toContain("edit index.html");
  });

  it("renders web search and fetch tools as first-class live actions", () => {
    const app = makeApp();
    app.addToolCall("webSearch", "...", undefined, "call_search");
    app.updateToolCallArgs("webSearch", "OpenCode tools documentation", { query: "OpenCode tools documentation", numResults: 5 }, "call_search");
    app.addToolResult("webSearch", "ok", false, "5 web results · exa", "call_search");
    app.addToolCall("webFetch", "...", undefined, "call_fetch");
    app.updateToolCallArgs("webFetch", "https://developers.openai.com/codex/cli/features", { url: "https://developers.openai.com/codex/cli/features", format: "markdown" }, "call_fetch");
    app.addToolResult("webFetch", "ok", false, "42 lines fetched · text/html", "call_fetch");

    const output = app.renderMessages(120).map((line: string) => stripAnsi(line)).join("\n");
    expect(output).toContain("web search OpenCode tools documentation");
    expect(output).toContain("5 web results · exa");
    expect(output).toContain("fetch https://developers.openai.com/codex/cli/features");
    expect(output).toContain("42 lines fetched · text/html");
    expect(output).not.toContain("webSearch {");
    expect(output).not.toContain("webFetch {");
  });

  it("keeps simple create, edit, and read flows centered on visible action blocks", () => {
    const renderCreate = () => {
      const app = makeApp();
      app.addMessage("user", "make an index.html file");
      app.addToolCall("writeFile", "...", undefined, "call_create");
      app.updateToolCallArgs("writeFile", "index.html", { path: "index.html", content: "<h1>Hi</h1>" }, "call_create");
      app.addToolResult("writeFile", "ok", false, "1 line · 11 bytes written", "call_create");
      app.addMessage("assistant", "Done.");
      return app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    };

    const renderEdit = () => {
      const app = makeApp();
      app.addMessage("user", "edit this file");
      app.addToolCall("editFile", "index.html", { path: "index.html", old_string: "Hi", new_string: "Hello" }, "call_edit");
      app.addToolResult("editFile", "ok", false, "1 -> 1 lines replaced", "call_edit");
      app.addMessage("assistant", "Done.");
      return app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    };

    const renderRead = () => {
      const app = makeApp();
      app.addMessage("user", "read this file");
      app.addToolCall("readFile", "README.md", { path: "README.md", mode: "minimal" }, "call_read");
      app.addToolResult("readFile", "ok", false, "read 4 lines from README.md", "call_read");
      app.addMessage("assistant", "Done.");
      return app.renderMessages(96).map((line: string) => stripAnsi(line)).join("\n");
    };

    const outputs = [renderCreate(), renderEdit(), renderRead()];
    expect(outputs[0]).toContain("write index.html");
    expect(outputs[1]).toContain("edit index.html");
    expect(outputs[2]).toContain("read README.md");
    for (const output of outputs) {
      expect(output).toContain("Done.");
      expect(output).not.toContain("I'll");
      expect(output).not.toContain("I will");
      expect(output).not.toContain("planning");
    }
  });
});
