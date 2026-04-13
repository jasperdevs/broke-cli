import { describe, expect, it } from "vitest";
import { updateSetting, getSettings } from "../src/core/config.js";

describe("compaction threshold wiring", () => {
  it("persists compaction trigger percent in settings", () => {
    const previous = getSettings().compaction.triggerPercent;
    updateSetting("compaction", { ...getSettings().compaction, triggerPercent: 70 });
    expect(getSettings().compaction.triggerPercent).toBe(70);
    updateSetting("compaction", { ...getSettings().compaction, triggerPercent: previous });
  });
});
