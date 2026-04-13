import { describe, expect, it } from "vitest";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { Session } from "../src/core/session.js";
import { createAppStub, createSlashArgs } from "./slash-command-test-helpers.js";

describe("session UI actions", () => {
  it("requires typed confirmation before deleting the current persisted session from /session", async () => {
    const app = createAppStub();
    const session = new Session(`session-delete-${Date.now()}`);
    session.setName("Current Session");
    session.addMessage("user", "hello");
    app.showQuestion = async () => "DELETE";

    let onSelect: ((id: string) => void) | undefined;
    app.openItemPicker = (_title: string, _items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      onSelect = nextOnSelect;
    };

    let replaced: Session | null = null;
    const result = await handleSlashCommand({
      text: "/session",
      app,
      session,
      ...createSlashArgs({
        onSessionReplace(next: Session) {
          replaced = next;
        },
      }),
    });

    expect(result.handled).toBe(true);
    onSelect?.("__delete__");
    await Promise.resolve();
    expect(replaced).not.toBeNull();
    expect(replaced?.getId()).not.toBe(session.getId());
    expect(app.cleared).toBe(true);
    expect(app.statusMessage).toContain("Deleted persisted session");
  });

  it("cancels session deletion when the confirmation text does not match", async () => {
    const app = createAppStub();
    const session = new Session(`session-delete-cancel-${Date.now()}`);
    app.showQuestion = async () => "nope";

    let onSelect: ((id: string) => void) | undefined;
    app.openItemPicker = (_title: string, _items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      onSelect = nextOnSelect;
    };

    let replaced: Session | null = null;
    await handleSlashCommand({
      text: "/session",
      app,
      session,
      ...createSlashArgs({
        onSessionReplace(next: Session) {
          replaced = next;
        },
      }),
    });

    onSelect?.("__delete__");
    await Promise.resolve();
    expect(replaced).toBeNull();
    expect(app.statusMessage).toContain("cancelled");
  });

  it("can rename the current session from /session", async () => {
    const app = createAppStub();
    const session = new Session(`session-rename-${Date.now()}`);
    session.setName("Old Name");
    app.showQuestion = async () => "New Name";

    let onSelect: ((id: string) => void) | undefined;
    app.openItemPicker = (_title: string, _items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      onSelect = nextOnSelect;
    };

    await handleSlashCommand({
      text: "/session",
      app,
      session,
      ...createSlashArgs(),
    });

    onSelect?.("__rename__");
    await Promise.resolve();
    expect(session.getName()).toBe("New Name");
    expect(app.statusMessage).toContain("Session renamed to New Name");
  });

  it("drafts /tree from the session action menu", async () => {
    const app = createAppStub();
    const session = new Session(`session-tree-${Date.now()}`);
    let drafted = "";
    app.setDraft = (value: string) => {
      drafted = value;
    };

    let onSelect: ((id: string) => void) | undefined;
    app.openItemPicker = (_title: string, _items: Array<{ id: string; label: string; detail?: string }>, nextOnSelect: (id: string) => void) => {
      onSelect = nextOnSelect;
    };

    await handleSlashCommand({
      text: "/session",
      app,
      session,
      ...createSlashArgs(),
    });

    onSelect?.("__tree__");
    expect(drafted).toBe("/tree");
    expect(app.statusMessage).toContain("Drafted /tree");
  });
});
