import { describe, expect, it } from "vitest";
import { parseClaudeCliAuthToken, parseCodexCliAuthToken } from "../src/core/auth.js";
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

  it("ignores explicit Codex API-key auth in the OAuth-only runtime", () => {
    const parsed = parseCodexAuthData({
      auth_mode: "ApiKey",
      OPENAI_API_KEY: "sk-test-key",
    });

    expect(parsed.kind).toBe("none");
  });

  it("does not treat Codex API-key auth as a stored login", () => {
    expect(parseCodexCliAuthToken({
      auth_mode: "ApiKey",
      OPENAI_API_KEY: "sk-test-key-that-should-not-count",
    })).toBeNull();
    expect(parseCodexCliAuthToken({
      auth_mode: "ChatGPT",
      tokens: {
        access_token: "chatgpt-access-token-value-that-counts",
      },
    })).toBe("chatgpt-access-token-value-that-counts");
  });

  it("does not treat Claude API-key auth as a stored login", () => {
    expect(parseClaudeCliAuthToken({
      ANTHROPIC_API_KEY: "sk-ant-test-key-that-should-not-count",
      anthropic_api_key: "sk-ant-test-key-that-should-not-count",
      api_key: "sk-ant-test-key-that-should-not-count",
    })).toBeNull();
    expect(parseClaudeCliAuthToken({
      claudeAiOauth: {
        accessToken: "claude-oauth-token-value-that-counts",
      },
    })).toBe("claude-oauth-token-value-that-counts");
  });
});
