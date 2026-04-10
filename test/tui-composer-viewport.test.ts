import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";

describe("composer viewport and passive btw dismissal", () => {
  it("dismisses a completed /btw bubble on the next normal key and still applies that key", () => {
    const app = new App() as any;
    app.openBtwBubble({ question: "status?", answer: "done", modelLabel: "Claude Sonnet 4.6", pending: false });
    app.handleKey({ name: "space", char: " ", ctrl: false, meta: false, shift: false });
    expect(app.btwBubble).toBeNull();
    expect(app.input.getText()).toBe(" ");
  });

  it("caps the composer height and scrolls internally for large prompts", () => {
    const app = new App() as any;
    app.screen = { height: 20, width: 60, hasSidebar: false, mainWidth: 60, sidebarWidth: 0, render: () => {}, setCursor: () => {}, hideCursor: () => {}, forceRedraw: () => {} };
    app.input.setText(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
    app.input.setCursor(app.input.getText().length);

    const layout = app.getInputCursorLayout(app.input.getText(), app.input.getCursor(), 60);

    expect(layout.lines.length).toBeLessThanOrEqual(12);
    expect(layout.row).toBe(layout.lines.length - 1);
    expect(layout.viewportStart).toBeGreaterThan(0);
  });
});
