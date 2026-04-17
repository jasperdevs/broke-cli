import { afterEach, describe, expect, it } from "vitest";
import { filterModelIdsForDisplay } from "../src/ai/providers.js";
import { clearLocalModelMetadata, setLocalProviderModelMetadata } from "../src/ai/local-model-metadata.js";
import { getContextLimit } from "../src/ai/cost.js";
import { getPrettyModelName } from "../src/ai/model-catalog.js";

describe("local model metadata", () => {
  afterEach(() => {
    clearLocalModelMetadata();
  });

  it("keeps local metadata usable for display helpers without making local providers accepted", () => {
    setLocalProviderModelMetadata("ollama", {
      "tool-model": {
        name: "Tool Model",
        contextWindow: 64000,
        toolCall: true,
      },
      "chat-model": {
        name: "Chat Model",
        contextWindow: 32000,
        toolCall: false,
      },
    });

    const visible = filterModelIdsForDisplay("ollama", ["tool-model", "chat-model"]);
    expect(visible).toEqual(["chat-model", "tool-model"]);
    expect(getPrettyModelName("tool-model", "ollama")).toBe("Tool Model");
    expect(getContextLimit("tool-model", "ollama")).toBe(64000);
  });
});
