import { describe, expect, it } from "vitest";
import { ContextOptimizer } from "../src/core/context-optimizer.js";

describe("context optimizer attached file pruning", () => {
  it("replaces old attached file payloads with a compact replay note", () => {
    const optimizer = new ContextOptimizer();
    optimizer.nextTurn();
    const messages = [
      {
        role: "user" as const,
        content: "inspect this\n\n--- @src/app.ts ---\nconst x = 1;\nconst y = 2;",
      },
      { role: "assistant" as const, content: "Noted." },
      { role: "user" as const, content: "next" },
      { role: "assistant" as const, content: "ok" },
      { role: "user" as const, content: "later" },
      { role: "assistant" as const, content: "still going" },
      { role: "user" as const, content: "continue" },
      { role: "assistant" as const, content: "continuing" },
      { role: "user" as const, content: "more" },
      { role: "assistant" as const, content: "done" },
      { role: "user" as const, content: "final" },
      { role: "assistant" as const, content: "wrapped" },
      { role: "user" as const, content: "latest" },
    ];

    const optimized = optimizer.optimizeMessages(messages);

    expect(optimized[0]?.content).toContain("[attached file context omitted from replay]");
    expect(optimized[0]?.content).toContain("src/app.ts (2 lines)");
    expect(optimized[0]?.content).not.toContain("--- @src/app.ts ---");
  });
});
