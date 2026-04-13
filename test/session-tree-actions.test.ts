import { describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";

describe("session tree actions", () => {
  it("can overwrite and clear a custom entry label", () => {
    const session = new Session(`tree-label-${Date.now()}`);
    session.addMessage("user", "first");
    const entryId = session.getTreeItems("all")[0]!.id;

    expect(session.setEntryLabel(entryId, "focus")).toEqual({ labeled: true, value: "focus" });
    expect(session.getTreeEntry(entryId)?.label).toBe("focus");

    expect(session.setEntryLabel(entryId, "")).toEqual({ labeled: false });
    expect(session.getTreeEntry(entryId)?.label).toBeUndefined();
  });

  it("prunes a branch subtree and rewinds the active leaf when needed", () => {
    const session = new Session(`tree-prune-${Date.now()}`);
    session.addMessage("user", "root");
    session.addMessage("assistant", "branch");
    session.addMessage("user", "child");
    session.addMessage("assistant", "leaf");

    const branchId = session.getTreeItems("all").find((item) => item.content === "branch")!.id;
    const result = session.pruneBranch(branchId);

    expect(result.removed).toBe(3);
    expect(session.getMessages().map((message) => message.content)).toEqual(["root"]);
  });
});
