import { describe, expect, it } from "vitest";
import { listProjects, touchProject } from "../src/core/projects.js";

describe("project records", () => {
  it("stores and filters recent projects", () => {
    const cwd = process.cwd();
    touchProject(cwd, "test-session", "implement repo map");

    const results = listProjects(10, "repo map");

    expect(results.some((entry) => entry.cwd === cwd)).toBe(true);
  });
});
