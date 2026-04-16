import { describe, expect, it } from "vitest";
import { findExactModelReferenceMatch, resolveModelReferencePattern } from "../src/ai/model-reference.js";

const models = [
  { providerId: "codex", providerName: "Codex", modelId: "gpt-5.4", displayName: "GPT-5.4" },
  { providerId: "github-copilot", providerName: "GitHub Copilot", modelId: "gpt-5.4", displayName: "GPT-5.4" },
  { providerId: "anthropic", providerName: "Claude Code", modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
  { providerId: "anthropic", providerName: "Claude Code", modelId: "claude-sonnet-4-20250514", displayName: "Claude Sonnet 4" },
];

describe("Pi-style model reference resolution", () => {
  it("requires provider/model when a bare model id is ambiguous", () => {
    expect(findExactModelReferenceMatch("gpt-5.4", models)).toBeUndefined();
    expect(findExactModelReferenceMatch("codex/gpt-5.4", models)?.providerId).toBe("codex");
  });

  it("prefers alias models over dated versions for fuzzy matches", () => {
    const resolved = resolveModelReferencePattern("sonnet", models);
    expect(resolved?.modelId).toBe("claude-sonnet-4-6");
  });
});
