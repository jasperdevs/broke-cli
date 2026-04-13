import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { buildHtmlExport, publishTranscriptShare } from "../src/cli/exports.js";

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
    if (process.platform !== "win32") {
      expect(statSync(sharePath).mode & 0o777).toBe(0o600);
    }
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

  it("escapes raw assistant HTML and strips dangerous links in html exports", () => {
    const html = buildHtmlExport(
      [{
        role: "assistant",
        content: "<script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n[file](file:///etc/passwd)\n\n[ok](https://example.com)\n\n[mail](mailto:test@example.com)\n\n[jump](#section)",
        timestamp: Date.now(),
      }] as any,
      "openai",
      "gpt-5.4-mini",
      process.cwd(),
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).not.toContain('href="file:///etc/passwd"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:test@example.com"');
    expect(html).toContain('href="#section"');
  });

  it("allows only shipped message roles in export class names", () => {
    const html = buildHtmlExport(
      [{
        role: 'evil" onclick="alert(1)',
        content: "hello",
        timestamp: Date.now(),
      }] as any,
      "openai",
      "gpt-5.4-mini",
      process.cwd(),
    );

    expect(html).toContain('class="message user"');
    expect(html).not.toContain("onclick=");
  });
});
