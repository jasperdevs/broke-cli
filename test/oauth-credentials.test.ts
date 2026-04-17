import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { resetAuthCacheForTests, saveCredentials } from "../src/core/auth.js";
import { loadConfig, updateProviderConfig } from "../src/core/config.js";
import { getProviderCredential } from "../src/core/provider-credentials.js";
import { detectProviders } from "../src/ai/detect.js";

const authPath = join(homedir(), ".brokecli", "auth.json");

afterEach(() => {
  rmSync(authPath, { force: true });
  resetAuthCacheForTests();
});

describe("unsupported OAuth credential filtering", () => {
  it("ignores stored OAuth credentials for providers outside the SDK-only set", () => {
    saveCredentials("google-gemini-cli", JSON.stringify({ token: "test-token", projectId: "proj-123" }));
    expect(getProviderCredential("google-gemini-cli")).toEqual({ kind: "none" });
  });

  it("does not detect stored OAuth-only providers", async () => {
    const previousDisabled = loadConfig().providers?.["google-antigravity"]?.disabled;
    try {
      updateProviderConfig("google-antigravity", { disabled: false });
      saveCredentials("google-antigravity", JSON.stringify({ token: "test-token", projectId: "proj-456" }));
      const providers = await detectProviders();
      expect(providers.some((provider) => provider.id === "google-antigravity")).toBe(false);
    } finally {
      updateProviderConfig("google-antigravity", { disabled: previousDisabled ?? null });
    }
  });
});
