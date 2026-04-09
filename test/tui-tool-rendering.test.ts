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
});
