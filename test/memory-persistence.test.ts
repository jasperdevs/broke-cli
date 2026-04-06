import { afterEach, describe, expect, it } from "vitest";
import { Session } from "../src/core/session.js";
import { listProjects, touchProject } from "../src/core/projects.js";
import { updateSetting } from "../src/core/config.js";

describe("long-term memory gating", () => {
  afterEach(() => {
    updateSetting("autoSaveSessions", true);
  });

  it("hides saved sessions when auto-save is off", () => {
    updateSetting("autoSaveSessions", false);

    const recent = Session.listRecent(10);

    expect(recent).toEqual([]);
  });

  it("disables project recall when auto-save is off", () => {
    updateSetting("autoSaveSessions", false);
    touchProject(process.cwd(), "test-session", "remember this");

    expect(listProjects(10)).toEqual([]);
  });
});
