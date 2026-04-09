import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";

describe("pending recall behavior", () => {
  it("accumulates recalled pending messages in chronological order when Alt+Up is repeated", () => {
    const app = new App() as any;
    app.addPendingMessage("first", [], "followup");
    app.addPendingMessage("second", [], "steering");
    app.addPendingMessage("third", [], "followup");

    app.handleKey({ name: "up", char: "", ctrl: false, meta: true, shift: false });
    expect(app.input.getText()).toBe("third");

    app.handleKey({ name: "up", char: "", ctrl: false, meta: true, shift: false });
    expect(app.input.getText()).toBe("second\n\nthird");

    app.handleKey({ name: "up", char: "", ctrl: false, meta: true, shift: false });
    expect(app.input.getText()).toBe("first\n\nsecond\n\nthird");
    expect(app.pendingMessages).toEqual([]);
  });
});
