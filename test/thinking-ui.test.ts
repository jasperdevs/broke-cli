import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { App } from "../src/tui/app.js";
import { getAvailableThinkingLevels, getEffectiveThinkingLevel } from "../src/ai/thinking.js";
import { getSettings, updateSetting } from "../src/core/config.js";

describe("thinking UI semantics", () => {
  it("limits native and openai thinking levels to real effort tiers", () => {
    expect(getAvailableThinkingLevels({ providerId: "codex", modelId: "gpt-5-mini", runtime: "native-cli" })).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
    expect(getAvailableThinkingLevels({ providerId: "openai", modelId: "gpt-5.4-mini", runtime: "sdk" })).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
    expect(getAvailableThinkingLevels({ providerId: "anthropic", modelId: "claude-sonnet-4-6", runtime: "sdk" })).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("clamps unsupported display levels to the effective tier", () => {
    expect(getEffectiveThinkingLevel({
      providerId: "codex",
      modelId: "gpt-5-mini",
      runtime: "native-cli",
      level: "xhigh",
      enabled: true,
    })).toBe("high");
    expect(getEffectiveThinkingLevel({
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtime: "sdk",
      level: "minimal",
      enabled: true,
    })).toBe("low");
  });

  it("renders the clamped thinking level in the bottom bar", () => {
    const app = new App() as any;
    const settings = getSettings();
    const original = { thinkingLevel: settings.thinkingLevel, enableThinking: settings.enableThinking };
    try {
      updateSetting("thinkingLevel", "xhigh");
      updateSetting("enableThinking", true);
      app.setModel("Codex", "gpt-5-mini", { providerId: "codex", runtime: "native-cli" });
      app.messages = [{ role: "user", content: "hello" }];
      let rendered: string[] = [];
      app.screen = {
        height: 16,
        width: 80,
        hasSidebar: false,
        mainWidth: 80,
        sidebarWidth: 0,
        render: (lines: string[]) => { rendered = lines; },
        setCursor: () => {},
        hideCursor: () => {},
        forceRedraw: () => {},
      };
      app.drawImmediate();
      const output = rendered.map((line) => stripAnsi(line)).join("\n");
      expect(output).toContain("high");
      expect(output).not.toContain("xhigh");
    } finally {
      updateSetting("thinkingLevel", original.thinkingLevel);
      updateSetting("enableThinking", original.enableThinking);
    }
  });
});
