import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveProviderSdkConfig } from "../src/ai/provider-runtime.js";
import { setRuntimeProviderInfo, resetRuntimeProviders, type ProviderInfo } from "../src/ai/providers.js";
import { setRuntimeModelsConfigPathsForTests } from "../src/core/models-config.js";

describe.sequential("provider runtime config overrides", () => {
  let root = "";
  let globalModelsPath = "";
  const previousOpenAiKey = process.env.OPENAI_PROXY_KEY;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "brokecli-provider-config-"));
    globalModelsPath = join(root, "global-models.json");
    setRuntimeModelsConfigPathsForTests({ global: globalModelsPath, project: join(root, "project-models.json") });
    resetRuntimeProviders();
    delete process.env.OPENAI_PROXY_KEY;
  });

  afterEach(() => {
    if (previousOpenAiKey) process.env.OPENAI_PROXY_KEY = previousOpenAiKey;
    else delete process.env.OPENAI_PROXY_KEY;
    setRuntimeModelsConfigPathsForTests(null);
    resetRuntimeProviders();
    rmSync(root, { recursive: true, force: true });
  });

  it("applies models.json baseUrl and headers to built-in providers", () => {
    process.env.OPENAI_PROXY_KEY = "sk-proxy";
    writeFileSync(globalModelsPath, JSON.stringify({
      providers: {
        openai: {
          baseUrl: "https://proxy.example.com/v1",
          headers: {
            "x-route": "alpha",
          },
          apiKey: "OPENAI_PROXY_KEY",
        },
      },
    }), "utf-8");

    const info: ProviderInfo = {
      id: "openai",
      name: "OpenAI",
      defaultModel: "gpt-5.4-mini",
      models: ["gpt-5.4-mini"],
    };

    const config = resolveProviderSdkConfig("openai", info);
    expect(config.baseURL).toBe("https://proxy.example.com/v1");
    expect(config.headers).toEqual({ "x-route": "alpha" });
    expect(config.apiKey).toBe("sk-proxy");
  });

  it("uses provider info overrides when already merged into runtime providers", () => {
    const info: ProviderInfo = {
      id: "custom-openai",
      name: "Custom OpenAI",
      defaultModel: "acme-coder",
      models: ["acme-coder"],
      apiType: "openai-completions",
      baseUrl: "https://example.com/v1",
      headers: { "x-custom": "beta" },
      custom: true,
    };
    setRuntimeProviderInfo(info);

    const config = resolveProviderSdkConfig("custom-openai", info);
    expect(config.baseURL).toBe("https://example.com/v1");
    expect(config.headers).toEqual({ "x-custom": "beta" });
  });
});
