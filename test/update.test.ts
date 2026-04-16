import { describe, expect, it } from "vitest";
import { buildSelfUpdateCommand, compareVersions } from "../src/core/update.js";
import { RELEASES_URL, REPOSITORY_URL } from "../src/core/app-meta.js";
import { reportStartupUpdateNotice } from "../src/cli/program-runtime.js";

describe("update helpers", () => {
  it("compares semantic versions in numeric order", () => {
    expect(compareVersions("0.0.2", "0.0.1")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });

  it("builds self-update commands for supported install methods", () => {
    expect(buildSelfUpdateCommand("npm")?.display).toBe("npm install -g @jasperdevs/brokecli@latest");
    expect(buildSelfUpdateCommand("pnpm")?.display).toBe("pnpm add -g @jasperdevs/brokecli@latest");
    expect(buildSelfUpdateCommand("yarn")?.display).toBe("yarn global add @jasperdevs/brokecli@latest");
    expect(buildSelfUpdateCommand("bun")?.display).toBe("bun install -g @jasperdevs/brokecli@latest");
    expect(buildSelfUpdateCommand("unknown")).toBeUndefined();
  });

  it("normalizes the repository and release URLs from package metadata", () => {
    expect(REPOSITORY_URL).toBe("https://github.com/jasperdevs/broke-cli");
    expect(RELEASES_URL).toBe("https://github.com/jasperdevs/broke-cli/releases/latest");
  });

  it("sets the startup update banner state when a newer version is found", () => {
    let notice: unknown = null;
    let status = "";
    const update = {
      currentVersion: "0.0.3",
      latestVersion: "0.0.4",
      method: "npm" as const,
      instruction: "Run: npm install -g @jasperdevs/brokecli@latest",
      releasesUrl: RELEASES_URL,
      command: buildSelfUpdateCommand("npm")!,
    };

    reportStartupUpdateNotice({
      setUpdateNotice: (next) => { notice = next; },
      setStatus: (next) => { status = next; },
    }, update);

    expect(notice).toBe(update);
    expect(status).toContain("Update available: v0.0.4");
    expect(status).toContain("/update");
  });
});
