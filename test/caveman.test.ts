import { describe, expect, it } from "vitest";
import { buildSystemPrompt, resolveCavemanLevel } from "../src/core/context.js";
import { ContextOptimizer } from "../src/core/context-optimizer.js";
import { updateSetting } from "../src/core/config.js";

describe("caveman mode resolution", () => {
  it("keeps explicit non-auto levels unchanged", () => {
    expect(resolveCavemanLevel("ultra", "debug why auth token refresh does not work")).toBe("ultra");
    expect(resolveCavemanLevel("lite", "investigate memory leak and performance regression")).toBe("lite");
  });

  it("uses off for risky auto tasks", () => {
    expect(resolveCavemanLevel("auto", "debug why auth token refresh does not work")).toBe("off");
    expect(resolveCavemanLevel("auto", "research architecture tradeoffs for migration")).toBe("off");
  });

  it("uses ultra for safe auto tasks", () => {
    expect(resolveCavemanLevel("auto", "update README typo and docs")).toBe("ultra");
    expect(resolveCavemanLevel("auto", "fix css padding and wording on settings menu")).toBe("ultra");
  });

  it("uses ultra for short routine implementation in auto mode", () => {
    expect(resolveCavemanLevel("auto", "implement small config flag")).toBe("ultra");
    expect(resolveCavemanLevel("auto", "make sidebar scroll smoother")).toBe("ultra");
  });

  it("makes ultra prompt much harsher", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "ultra");

    expect(prompt).toContain("Target: ~85% fewer output tokens.");
    expect(prompt).toContain("Caveman ultra.");
    expect(prompt).toContain("Use arrows for causality");
  });

  it("compresses old context more aggressively in ultra", () => {
    updateSetting("cavemanLevel", "ultra");
    const optimizer = new ContextOptimizer();
    const long = Array.from({ length: 40 }, (_, i) => `line ${i} directory configuration implementation response request function message`).join("\n");
    const messages = Array.from({ length: 6 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: long,
    }));

    const optimized = optimizer.optimizeMessages(messages);

    expect(optimized[0].content).toContain("compressed");
    expect(optimized[0].content).toContain("dir");
    expect(optimized[0].content).toContain("cfg");
    expect(optimized[0].content.length).toBeLessThan(messages[0].content.length);

    updateSetting("cavemanLevel", "off");
  });
});
