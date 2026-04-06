import { describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";
import { App } from "../src/tui/app.js";
import { MOUSE_OFF, MOUSE_ON } from "../src/utils/ansi.js";
import stripAnsi from "strip-ansi";

describe("session token accounting", () => {
  it("keeps separate input and output totals", () => {
    const session = new Session("test-session");
    session.addUsage(120, 45, 0.0012);
    session.addUsage(30, 15, 0.0004);

    expect(session.getTotalInputTokens()).toBe(150);
    expect(session.getTotalOutputTokens()).toBe(60);
    expect(session.getTotalTokens()).toBe(210);
  });
});

describe("mouse reporting mode", () => {
  it("uses normal tracking so drag selection is not captured", () => {
    expect(MOUSE_ON).toContain("?1000h");
    expect(MOUSE_OFF).toContain("?1000l");
    expect(MOUSE_ON).not.toContain("?1002h");
    expect(MOUSE_OFF).not.toContain("?1002l");
  });
});

describe("sidebar token summary", () => {
  it("renders labeled input, output, and total counts", () => {
    const app = new App() as any;
    app.setContextUsage(132, 344_000);
    app.updateUsage(0.0016, 150, 60);

    expect(app.renderTokenSummaryParts()).toEqual([
      "↑ 150 in",
      "↓ 60 out",
      "Σ 210/344k total",
    ]);
  });
});

describe("command aliases", () => {
  it("suggests clear for the new alias", () => {
    const app = new App() as any;
    app.input.paste("/new");

    const matches = app.getCommandMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe("clear");
  });
});

describe("sidebar scrolling", () => {
  it("keeps long file trees scrollable", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hi" }];
    app.sidebarTreeOpen = true;
    app.sidebarFocused = true;
    app.sidebarFileTree = [
      {
        name: "src",
        isDir: true,
        children: Array.from({ length: 12 }, (_, i) => `file-${i}.ts`),
        depth: 0,
      },
    ];
    app.sidebarExpandedDirs.add("src");
    app.sidebarExpandedDirs.add("src:all");

    const before = app.renderSidebar(12).map((line: string) => stripAnsi(line));
    app.scrollSidebar(4, 12);
    const after = app.renderSidebar(12).map((line: string) => stripAnsi(line));

    expect(before.join("\n")).toContain("src/");
    expect(after[0]).toContain("↑ more");
    expect(after.join("\n")).toContain("file-");
  });
});

describe("wrapped input layout", () => {
  it("wraps long input lines and tracks cursor row/column", () => {
    const app = new App() as any;
    const layout = app.getInputCursorLayout("one two three four five", 23, 16);

    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.row).toBeGreaterThan(0);
    expect(layout.col).toBeGreaterThanOrEqual(0);
  });
});

describe("thinking preview", () => {
  it("persists the last thought block until the next user turn", () => {
    const app = new App() as any;

    app.setStreaming(true);
    app.appendThinking("first pass");
    app.setStreaming(false);

    expect(app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n")).toContain("thought");

    app.addMessage("user", "next");
    expect(app.renderMessages(80).map((line: string) => stripAnsi(line)).join("\n")).not.toContain("thought");
  });
});
