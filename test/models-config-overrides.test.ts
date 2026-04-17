import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getContextLimit } from "../src/ai/cost.js";
import { getPrettyModelName } from "../src/ai/model-catalog.js";
import { detectProviders } from "../src/ai/detect.js";
import { resetRuntimeProviders, supportsProviderModel } from "../src/ai/providers.js";
import { applyConfiguredProviderOverrides } from "../src/ai/provider-overrides.js";
import { createModel } from "../src/ai/provider-runtime.js";
import { setRuntimeModelsConfigPathsForTests } from "../src/core/models-config.js";

describe.sequential("models.json overrides", () => {
  let root = "";
  let globalModelsPath = "";
  let projectModelsPath = "";
  const previousEnv = process.env.CUSTOM_PROVIDER_KEY;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "brokecli-models-config-"));
    globalModelsPath = join(root, "global-models.json");
    projectModelsPath = join(root, "project-models.json");
    setRuntimeModelsConfigPathsForTests({ global: globalModelsPath, project: projectModelsPath });
    resetRuntimeProviders();
    delete process.env.CUSTOM_PROVIDER_KEY;
  });

  afterEach(() => {
    if (previousEnv) process.env.CUSTOM_PROVIDER_KEY = previousEnv;
    else delete process.env.CUSTOM_PROVIDER_KEY;
    setRuntimeModelsConfigPathsForTests(null);
    resetRuntimeProviders();
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("applies model overrides on top of built-in catalog metadata", () => {
    writeFileSync(globalModelsPath, JSON.stringify({
      providers: {
        openai: {
          modelOverrides: {
            "gpt-4o": {
              name: "GPT-4o Custom",
              contextWindow: 222222,
            },
          },
        },
      },
    }), "utf-8");

    expect(getPrettyModelName("gpt-4o", "openai")).toBe("GPT-4o Custom");
    expect(getContextLimit("gpt-4o", "openai")).toBe(222222);
  });

  it("merges custom models into built-in providers", () => {
    writeFileSync(globalModelsPath, JSON.stringify({
      providers: {
        openai: {
          models: [
            {
              id: "acme-coder",
              name: "Acme Coder",
              reasoning: true,
              input: ["text"],
              contextWindow: 64000,
              maxTokens: 8000,
            },
          ],
        },
      },
    }), "utf-8");

    applyConfiguredProviderOverrides();
    expect(supportsProviderModel("openai", "acme-coder")).toBe(true);
    expect(getPrettyModelName("acme-coder", "openai")).toBe("Acme Coder");
    expect(getContextLimit("acme-coder", "openai")).toBe(64000);
  });

  it("does not detect custom API providers in the OAuth-only runtime", async () => {
    process.env.CUSTOM_PROVIDER_KEY = "test-custom-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      return {
        ok: url === "https://example.com/v1/models",
        status: url === "https://example.com/v1/models" ? 200 : 404,
        json: async () => ({ data: [] }),
      } as Response;
    });
    writeFileSync(globalModelsPath, JSON.stringify({
      providers: {
        "custom-openai": {
          name: "Custom OpenAI",
          baseUrl: "https://example.com/v1",
          api: "openai-completions",
          apiKey: "CUSTOM_PROVIDER_KEY",
          models: [
            {
              id: "acme-coder",
              name: "Acme Coder",
              reasoning: true,
              input: ["text"],
              contextWindow: 64000,
              maxTokens: 8000,
            },
          ],
        },
      },
    }), "utf-8");

    applyConfiguredProviderOverrides();
    const providers = await detectProviders();
    expect(providers.some((provider) => provider.id === "custom-openai")).toBe(false);
    expect(() => createModel("custom-openai", "acme-coder")).toThrow("Unsupported provider");
  }, 15_000);

  it("lets project models.json override global models.json", () => {
    writeFileSync(globalModelsPath, JSON.stringify({
      providers: {
        openai: {
          modelOverrides: {
            "gpt-4o": { name: "Global GPT-4o" },
          },
        },
      },
    }), "utf-8");
    writeFileSync(projectModelsPath, JSON.stringify({
      providers: {
        openai: {
          modelOverrides: {
            "gpt-4o": { name: "Project GPT-4o" },
          },
        },
      },
    }), "utf-8");

    expect(getPrettyModelName("gpt-4o", "openai")).toBe("Project GPT-4o");
  });
});
