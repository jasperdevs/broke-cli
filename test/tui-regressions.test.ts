import { describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";
import { App } from "../src/tui/app.js";
import { MOUSE_OFF, MOUSE_ON } from "../src/utils/ansi.js";

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
    app.updateUsage(0.0016, 150, 60);

    expect(app.renderTokenSummaryParts()).toEqual([
      "↑ 150 in",
      "↓ 60 out",
      "Σ 210 total",
    ]);
  });
});
