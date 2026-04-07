import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { resetAuthCacheForTests, saveCredentials } from "../src/core/auth.js";
import { getProviderCredential, loadConfig, updateProviderConfig } from "../src/core/config.js";
import { detectProviders } from "../src/ai/detect.js";

const authPath = join(homedir(), ".brokecli", "auth.json");

afterEach(() => {
  rmSync(authPath, { force: true });
  resetAuthCacheForTests();
});

describe("oauth credential detection", () => {
  it("treats stored Gemini CLI auth as a native oauth provider", () => {
    saveCredentials("google-gemini-cli", JSON.stringify({ token: "test-token", projectId: "proj-123" }));
    expect(getProviderCredential("google-gemini-cli")).toEqual({
      kind: "native_oauth",
      value: JSON.stringify({ token: "test-token", projectId: "proj-123" }),
      source: "brokecli-auth",
    });
  });

  it("includes stored oauth providers in detected provider results", async () => {
    const previousDisabled = loadConfig().providers?.["google-antigravity"]?.disabled;
    try {
      updateProviderConfig("google-antigravity", { disabled: false });
      saveCredentials("google-antigravity", JSON.stringify({ token: "test-token", projectId: "proj-456" }));
      const providers = await detectProviders();
      expect(providers.some((provider) => provider.id === "google-antigravity")).toBe(true);
    } finally {
      updateProviderConfig("google-antigravity", { disabled: previousDisabled ?? null });
    }
  });
});
