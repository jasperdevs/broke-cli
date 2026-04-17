import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("Vercel AI SDK architecture", () => {
  it("keeps SDK-backed providers on the Vercel AI SDK packages", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};

    expect(deps.ai).toBeTruthy();
    expect(deps["@ai-sdk/openai"]).toBeTruthy();
    expect(deps["@ai-sdk/anthropic"]).toBeTruthy();
    expect(deps["@ai-sdk/google"]).toBeTruthy();
    expect(deps["@ai-sdk/mistral"]).toBeTruthy();
    expect(deps["@ai-sdk/xai"]).toBeTruthy();
  });

  it("routes SDK streaming through the Vercel AI SDK streamText API", () => {
    const streamSource = readFileSync("src/ai/stream.ts", "utf-8");
    expect(streamSource).toContain('from "ai"');
    expect(streamSource).toContain("streamText({");
    expect(streamSource).toContain("stepCountIs(");
  });

  it("builds provider model handles from Vercel AI SDK provider factories", () => {
    const runtimeSource = readFileSync("src/ai/provider-runtime.ts", "utf-8");
    expect(runtimeSource).toContain('from "@ai-sdk/openai"');
    expect(runtimeSource).toContain('from "@ai-sdk/anthropic"');
    expect(runtimeSource).toContain('from "@ai-sdk/google"');
    expect(runtimeSource).toContain('from "@ai-sdk/mistral"');
    expect(runtimeSource).toContain('from "@ai-sdk/xai"');
  });
});
