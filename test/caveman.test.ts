import { describe, expect, it } from "vitest";
import { buildSystemPrompt, resolveCavemanLevel } from "../src/core/context.js";
import { rewriteAssistantForCaveman } from "../src/core/caveman.js";
import { ContextOptimizer } from "../src/core/context-optimizer.js";
import { DEFAULT_SETTINGS, updateSetting } from "../src/core/config.js";

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

  it("uses ultra for short chatter in auto mode", () => {
    expect(resolveCavemanLevel("auto", "hey")).toBe("ultra");
    expect(resolveCavemanLevel("auto", "how are you")).toBe("ultra");
    expect(resolveCavemanLevel("auto", "thanks")).toBe("ultra");
  });

  it("makes ultra prompt much harsher", () => {
    const prompt = buildSystemPrompt(process.cwd(), "openai", "build", "ultra");

    expect(prompt).toContain("CAVEMAN ULTRA ACTIVE.");
    expect(prompt).toContain("Mouth small. Brain same.");
    expect(prompt).toContain("Use verdict first.");
    expect(prompt).toContain("Code blocks unchanged.");
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
    expect(optimized[0].content).toContain("directory");
    expect(optimized[0].content).toContain("configuration");
    expect(optimized[0].content.length).toBeLessThan(messages[0].content.length);

    updateSetting("cavemanLevel", "off");
  });

  it("defaults caveman to auto", () => {
    expect(DEFAULT_SETTINGS.cavemanLevel).toBe("auto");
  });

  it("rewrites verbose assistant prose into obvious caveman output", () => {
    const input = "Sure! I'd be happy to help with that. The reason your React component is re-rendering is because you're creating a new object reference on each render cycle. I would recommend using `useMemo`.";
    const output = rewriteAssistantForCaveman(input, "ultra");

    expect(output).toContain("React component is re-rendering bc");
    expect(output).toContain("Use `useMemo`");
    expect(output).not.toContain("happy to help");
    expect(output).not.toContain("I would recommend");
  });

  it("keeps code fences unchanged while compressing surrounding text", () => {
    const input = "Sure, use this fix.\n```ts\nconst value = 1;\n```\nIt should solve the issue because the old path was wrong.";
    const output = rewriteAssistantForCaveman(input, "ultra");

    expect(output).toContain("```ts\nconst value = 1;\n```");
    expect(output).toContain("solve issue bc old path was wrong");
    expect(output).not.toContain("Sure");
  });
});
