import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { publishTranscriptShare } from "../src/cli/exports.js";

const shareDir = join(homedir(), ".brokecli", "shares", "test-project");
const sharePath = join(shareDir, "exports-test.html");

describe("publishTranscriptShare", () => {
  const originalToken = process.env.BROKECLI_SHARE_GITHUB_TOKEN;

  afterEach(() => {
    process.env.BROKECLI_SHARE_GITHUB_TOKEN = originalToken;
    vi.restoreAllMocks();
    if (existsSync(sharePath)) rmSync(sharePath, { force: true });
  });

  it("falls back to a local file when no share token is present", async () => {
    delete process.env.BROKECLI_SHARE_GITHUB_TOKEN;

    const result = await publishTranscriptShare({
      html: "<html>local</html>",
      filePath: sharePath,
      description: "local share",
    });

    expect(result.kind).toBe("local");
    expect(existsSync(sharePath)).toBe(true);
    expect(readFileSync(sharePath, "utf-8")).toContain("local");
  });

  it("publishes a secret gist when a share token is present", async () => {
    process.env.BROKECLI_SHARE_GITHUB_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "gist-id", html_url: "https://gist.github.com/secret" }),
    })));

    const result = await publishTranscriptShare({
      html: "<html>gist</html>",
      filePath: sharePath,
      description: "gist share",
    });

    expect(result).toEqual({
      kind: "gist",
      id: "gist-id",
      url: "https://gist.github.com/secret",
    });
  });
});
