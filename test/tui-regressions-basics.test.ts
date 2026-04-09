import { describe, expect, it } from "vitest";
import { createDefaultSessionName, Session } from "../src/core/session.js";
import { App } from "../src/tui/app.js";
import { MOUSE_OFF, MOUSE_ON, sanitizeWindowTitle } from "../src/utils/ansi.js";
import { ALT_SCREEN_OFF, ALT_SCREEN_ON, CURSOR_HIDE, KITTY_KEYBOARD_OFF, KITTY_KEYBOARD_ON, MENU_MOUSE_OFF, MENU_MOUSE_ON, SYNC_START } from "../src/utils/ansi.js";
import { visibleWidth } from "../src/utils/terminal-width.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import { currentTheme } from "../src/core/themes.js";
import stripAnsi from "strip-ansi";
import { renderStaticMessages } from "../src/tui/render/messages.js";
import { wordWrap } from "../src/tui/render/formatting.js";
import { Screen } from "../src/tui/screen.js";

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
  it("keeps mouse tracking disabled so terminal text selection stays native", () => {
    expect(MOUSE_ON).toBe("");
    expect(MOUSE_OFF).toBe("");
  });

  it("keeps passive sidebar mode out of mouse-capture until a modal owns the UI", () => {
    const originalHideSidebar = getSettings().hideSidebar;
    updateSetting("hideSidebar", false);
    try {
      const app = new App() as any;
      app.messages = [{ role: "user", content: "hello" }];
      app.screen = { height: 18, width: 100, hasSidebar: true, mainWidth: 73, sidebarWidth: 24, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
      expect(app.shouldEnableMenuMouse()).toBe(false);
    } finally {
      updateSetting("hideSidebar", originalHideSidebar);
    }
  });

  it("uses button-event mouse tracking for interactive panes so wheel scrolling can reach the TUI", () => {
    expect(MENU_MOUSE_ON).toContain("?1002h");
    expect(MENU_MOUSE_OFF).toContain("?1002l");
  });

  it("enables kitty keyboard protocol so modified enter keys stay distinguishable", () => {
    expect(KITTY_KEYBOARD_ON).toBe("\x1b[>1u");
    expect(KITTY_KEYBOARD_OFF).toBe("\x1b[<u");
  });
});

describe("screen buffer mode", () => {
  it("enters the alternate screen so the TUI stays fullscreen instead of living in scrollback", () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    (process.stdout.write as unknown as (chunk: any, ...args: any[]) => boolean) = ((chunk: any, ...args: any[]) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const screen = new Screen();
      screen.enter();
      screen.exit();
      expect(writes.join("")).toContain(ALT_SCREEN_ON);
      expect(writes.join("")).toContain(ALT_SCREEN_OFF);
    } finally {
      (process.stdout.write as unknown as typeof process.stdout.write) = originalWrite;
    }
  });

  it("does not hide the cursor again on every render frame", () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    (process.stdout.write as unknown as (chunk: any, ...args: any[]) => boolean) = ((chunk: any, ...args: any[]) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const screen = new Screen();
      screen.forceRedraw(["hello"]);
      const output = writes.join("");
      expect(output).toContain(SYNC_START);
      expect(output).toContain(CURSOR_HIDE);
      expect(output).not.toContain(`${"\x1b[1;1H"}${"\x1b[?2026l"}`);
    } finally {
      (process.stdout.write as unknown as typeof process.stdout.write) = originalWrite;
    }
  });
});

describe("message wrapping", () => {
  it("wraps system output without chopping ordinary words mid-line", () => {
    const lines = renderStaticMessages({
      messages: [{ role: "system", content: "warning: in the working copy of index.html LF will be replaced by CRLF the next time Git touches it" }],
      maxWidth: 32,
      toolOutputCollapsed: false,
      isToolOutput: () => false,
      wordWrap,
      colors: { imageTagBg: "", userBg: "", userText: "", userAccent: "", border: "", muted: "", text: "" },
      reset: "",
      bold: "",
    }).map((line) => stripAnsi(line));
    expect(lines.join("\n")).toContain("working");
    expect(lines.join("\n")).toContain("replaced");
    expect(lines.join("\n")).not.toContain("wor\nking");
  });

  it("renders a left accent rail for user messages", () => {
    const lines = renderStaticMessages({
      messages: [{ role: "user", content: "hello world" }],
      maxWidth: 24,
      toolOutputCollapsed: false,
      isToolOutput: () => false,
      wordWrap,
      colors: { imageTagBg: "", userBg: "", userText: "", userAccent: "", border: "", muted: "", text: "" },
      reset: "",
      bold: "",
    }).map((line) => stripAnsi(line));
    expect(lines.some((line) => line.startsWith("▌"))).toBe(true);
  });

  it("drops markdown ANSI styling in light themes so assistant text stays readable", () => {
    const lines = renderStaticMessages({
      messages: [{ role: "assistant", content: "Use `npm run build` and **watch** the output." }],
      maxWidth: 60,
      toolOutputCollapsed: false,
      isToolOutput: () => false,
      wordWrap,
      colors: { imageTagBg: "", userBg: "", userText: "", userAccent: "", border: "", muted: "", text: "" },
      reset: "",
      bold: "",
    });
    expect(lines.join("\n")).toContain("npm run build");
    expect(lines.join("\n")).toContain("watch");
  });
});

describe("default session naming", () => {
  it("starts sessions with a date-and-number placeholder name", () => {
    const session = new Session("test-default-name");
    expect(session.getName()).toMatch(/^[A-Z][a-z]{2} \d{1,2} #\d{4}$/);
  });

  it("can generate a stable placeholder name for resets", () => {
    expect(createDefaultSessionName(new Date("2026-04-07T12:00:00Z"), 4821)).toBe("Apr 7 #4821");
  });
});

describe("terminal window title", () => {
  it("sanitizes control bytes out of the native terminal title", () => {
    expect(sanitizeWindowTitle("hello\x1b]2;bad\x07 title")).toBe("hello ]2;bad title");
  });

  it("tracks the session name in the native terminal title", () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    (process.stdout.write as unknown as (chunk: any, ...args: any[]) => boolean) = ((chunk: any, ...args: any[]) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const app = new App() as any;
      app.setSessionName("Bug bash");
      expect(writes.join("")).toContain("\x1b]2;Bug bash\x07");
    } finally {
      (process.stdout.write as unknown as typeof process.stdout.write) = originalWrite;
    }
  });

  it("uses the same spinner glyph family in the native terminal title while streaming", () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    (process.stdout.write as unknown as (chunk: any, ...args: any[]) => boolean) = ((chunk: any, ...args: any[]) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const app = new App() as any;
      app.setSessionName("Bug bash");
      app.setStreaming(true);
      expect(writes.join("")).toContain("\x1b]2;· Bug bash\x07");
      if (app.spinnerTimer) clearInterval(app.spinnerTimer);
    } finally {
      (process.stdout.write as unknown as typeof process.stdout.write) = originalWrite;
    }
  });
});

describe("sidebar token summary", () => {
  it("renders total plus input and output counts", () => {
    const app = new App() as any;
    app.setContextUsage(132, 344_000);
    app.updateUsage(0.0016, 150, 60);
    expect(app.renderTokenSummaryParts()).toEqual(["$0.0016", "210 total", "150 in", "60 out"]);
  });

  it("keeps the sidebar footer focused on token and context state only", () => {
    const app = new App() as any;
    app.setContextUsage(132, 344_000);
    app.updateUsage(0.0016, 150, 60);
    const footer = app.renderSidebarFooter().map((line: string) => stripAnsi(line)).join("\n");
    expect(footer).toContain("210 total");
    expect(footer).toContain("132/344k");
    expect(footer).not.toContain("build");
  });

  it("shows a bottom bar in compact view without token clutter", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    app.setModel("OpenAI", "gpt-5.4-mini", { providerId: "openai", runtime: "sdk" });
    let rendered: string[] = [];
    app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("build");
    expect(output).not.toContain("210 total");
    expect(output).not.toContain("$0.0016");
  });

  it("keeps mode, thinking, and caveman badges in the bottom bar when the main footer owns status", () => {
    const app = new App() as any;
    const settings = getSettings();
    const original = { thinkingLevel: settings.thinkingLevel, enableThinking: settings.enableThinking, cavemanLevel: settings.cavemanLevel };
    try {
      updateSetting("thinkingLevel", "low");
      updateSetting("enableThinking", true);
      updateSetting("cavemanLevel", "ultra");
      app.setModel("OpenAI", "gpt-5.4-mini", { providerId: "openai", runtime: "sdk" });
      app.messages = [{ role: "user", content: "hello" }];
      let rendered: string[] = [];
      app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
      app.drawImmediate();
      const output = rendered.map((line) => stripAnsi(line)).join("\n");
      expect(output).toContain("GPT-5.4 mini");
      expect(output).toContain("build");
      expect(output).not.toContain("/ commands");
      expect(output).not.toContain("@ files");
    } finally {
      updateSetting("thinkingLevel", original.thinkingLevel);
      updateSetting("enableThinking", original.enableThinking);
      updateSetting("cavemanLevel", original.cavemanLevel ?? "off");
    }
  });

  it("does not advertise the old alt+a tree shortcut in the bottom bar", () => {
    const app = new App() as any;
    app.messages = [{ role: "user", content: "hello" }];
    let rendered: string[] = [];
    app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.drawImmediate();
    expect(rendered.map((line) => stripAnsi(line)).join("\n")).not.toContain("alt+a tree");
  });
});

describe("menu counters", () => {
  it("shows a count in the slash command suggestion menu", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.input.setText("/");
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Commands (1/");
  });

  it("shows a count in item pickers", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = { height: 16, width: 80, hasSidebar: false, mainWidth: 80, sidebarWidth: 0, render: (lines: string[]) => { rendered = lines; }, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.openItemPicker("Projects", [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ], () => {}, { kind: "projects" });
    app.drawImmediate();
    const output = rendered.map((line) => stripAnsi(line)).join("\n");
    expect(output).toContain("Projects (1/2)");
  });
});

describe("terminal cell width", () => {
  it("pads and decorates frame lines to the exact terminal width even with emoji and ANSI", () => {
    const app = new App() as any;
    const raw = ` ${currentTheme().warning}🪨 ultra${"\x1b[0m"} | ${currentTheme().textMuted}total 210${"\x1b[0m"}`;
    const padded = app.padLine(raw, 18);
    const framed = app.decorateFrameLine(`${padded} ${app.getSidebarBorder()} ${app.padLine("Directory", 10)}`, 31);
    expect(visibleWidth(framed)).toBe(31);
    expect(visibleWidth(app.decorateFrameLine(raw, 18))).toBe(18);
  });
});
