import { describe, it, expect } from "vitest";
import { BrokecliConfigSchema } from "../../src/config/schema.js";

describe("config schema", () => {
  it("parses empty object with all defaults", () => {
    const result = BrokecliConfigSchema.parse({});

    expect(result.routing.strategy).toBe("manual");
    expect(result.routing.localFallback).toBe(true);
    expect(result.routing.thinkingLevel).toBe("medium");
    expect(result.budget.warningThreshold).toBe(0.8);
    expect(result.context.compaction).toBe("auto");
    expect(result.context.maxOutputLines).toBe(200);
    expect(result.cache.maxEntries).toBe(1000);
    expect(result.permissions.allow).toEqual([]);
    expect(result.permissions.deny).toEqual([]);
    expect(result.mcp).toEqual({});
    expect(result.hooks).toEqual({});
  });

  it("validates routing strategy enum", () => {
    const result = BrokecliConfigSchema.safeParse({
      routing: { strategy: "invalid" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid provider config", () => {
    const result = BrokecliConfigSchema.parse({
      providers: {
        anthropic: { apiKey: "sk-test", enabled: true },
        ollama: { baseUrl: "http://localhost:11434/v1" },
      },
    });
    expect(result.providers.anthropic.apiKey).toBe("sk-test");
    expect(result.providers.ollama.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("accepts valid MCP server config", () => {
    const result = BrokecliConfigSchema.parse({
      mcp: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "ghp_test" },
        },
      },
    });
    expect(result.mcp.github.command).toBe("npx");
    expect(result.mcp.github.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
  });

  it("accepts valid hooks config", () => {
    const result = BrokecliConfigSchema.parse({
      hooks: {
        PreToolUse: [
          { command: "node guard.js", matcher: "bash" },
        ],
      },
    });
    expect(result.hooks.PreToolUse).toHaveLength(1);
    expect(result.hooks.PreToolUse[0].matcher).toBe("bash");
  });
});
