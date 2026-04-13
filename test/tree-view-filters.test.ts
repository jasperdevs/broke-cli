import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";
import { Session } from "../src/core/session.js";
import { toggleTreeFilter } from "../src/tui/tree-view.js";

describe("tree view filter cycling", () => {
  it("cycles through the full pi-style filter order", () => {
    const app = new App() as any;
    const session = new Session(`tree-filter-${Date.now()}`);
    session.addMessage("user", "first");
    session.addMessage("assistant", "reply");
    app.openTreeView("Session Tree", session, () => {});

    expect(app.treeView.filterMode).toBe("default");
    toggleTreeFilter(app);
    expect(app.treeView.filterMode).toBe("no-tools");
    toggleTreeFilter(app);
    expect(app.treeView.filterMode).toBe("user-only");
    toggleTreeFilter(app);
    expect(app.treeView.filterMode).toBe("labeled-only");
    toggleTreeFilter(app);
    expect(app.treeView.filterMode).toBe("all");
    toggleTreeFilter(app);
    expect(app.treeView.filterMode).toBe("default");
  });
});
