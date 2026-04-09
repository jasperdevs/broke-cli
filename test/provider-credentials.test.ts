import { describe, expect, it } from "vitest";
import { parseClaudeCredentialsData, parseCodexAuthData } from "../src/core/provider-credentials.js";

describe("provider credential parsing", () => {
  it("treats Claude Code OAuth as native-only rather than an Anthropic API key", () => {
    const parsed = parseClaudeCredentialsData({
      claudeAiOauth: {
        accessToken: "oauth-token-value-that-is-clearly-not-an-api-key",
      },
    });

    expect(parsed.kind).toBe("native_oauth");
  });

  it("treats Codex ChatGPT auth tokens as native-only rather than an OpenAI API key", () => {
    const parsed = parseCodexAuthData({
      auth_mode: "Chatgpt",
      tokens: {
        access_token: "chatgpt-access-token-value",
      },
    });

    expect(parsed.kind).toBe("native_oauth");
  });

  it("keeps explicit Codex API-key auth usable", () => {
    const parsed = parseCodexAuthData({
      auth_mode: "ApiKey",
      OPENAI_API_KEY: "sk-test-key",
    });

    expect(parsed.kind).toBe("api_key");
    expect(parsed.value).toBe("sk-test-key");
  });
});
