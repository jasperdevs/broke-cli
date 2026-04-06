import { afterEach, describe, expect, it } from "vitest";
import { listProjects, touchProject } from "../src/core/projects.js";
import { updateSetting } from "../src/core/config.js";

describe("project records", () => {
  afterEach(() => {
    updateSetting("autoSaveSessions", true);
  });

  it("stores and filters recent projects", () => {
    updateSetting("autoSaveSessions", true);
    const cwd = process.cwd();
    touchProject(cwd, "test-session", "implement repo map");

    const results = listProjects(10, "repo map");

    expect(results.some((entry) => entry.cwd === cwd)).toBe(true);
  });
});
