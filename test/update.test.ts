import { describe, expect, it } from "vitest";
import { buildSelfUpdateCommand, compareVersions } from "../src/core/update.js";
import { RELEASES_URL, REPOSITORY_URL } from "../src/core/app-meta.js";

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
});
