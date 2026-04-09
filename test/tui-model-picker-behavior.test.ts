import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";

describe("model picker behavior", () => {
  it("defaults the lane picker to chat instead of silently selecting all lanes", () => {
    const app = new App() as any;
    const selectedCalls: Array<[string, string]> = [];
    const assignedCalls: Array<[string, string, string]> = [];

    app.openModelPicker(
      [{ providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.4-mini", displayName: "GPT-5.4 mini", active: false }],
      (providerId: string, modelId: string) => selectedCalls.push([providerId, modelId]),
      () => {},
      (providerId: string, modelId: string, slot: string) => assignedCalls.push([providerId, modelId, slot]),
      0,
    );

    app.handleKey({ name: "enter", char: "", ctrl: false, meta: false, shift: false });
    expect(app.modelLanePicker.cursor).toBe(1);

    app.handleKey({ name: "enter", char: "", ctrl: false, meta: false, shift: false });
    expect(selectedCalls).toEqual([["openai", "gpt-5.4-mini"]]);
    expect(assignedCalls).toEqual([["openai", "gpt-5.4-mini", "default"]]);
  });
});
