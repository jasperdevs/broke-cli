import { describe, expect, it } from "vitest";
import { createTurnTimestamp } from "../src/core/turn-events.js";
import { buildTurnActivitySnapshot, createTurnActivityState, recordTurnEvent } from "../src/tui/turn-activity-state.js";

describe("turn activity state", () => {
  it("builds a completed activity snapshot from explicit tool lifecycle events", () => {
    const state = createTurnActivityState();
    recordTurnEvent(state, { type: "activity.summary", summary: "reviewing the code", timestamp: createTurnTimestamp(1) });
    recordTurnEvent(state, {
      type: "tool.started",
      invocationId: "call_1",
      callId: "call_1",
      toolName: "readFile",
      preview: "src/app.ts",
      args: { path: "src/app.ts" },
      timestamp: createTurnTimestamp(2),
    });
    recordTurnEvent(state, {
      type: "tool.updated",
      invocationId: "call_1",
      callId: "call_1",
      toolName: "readFile",
      preview: "src/app.ts",
      args: { path: "src/app.ts", mode: "full" },
      timestamp: createTurnTimestamp(3),
    });
    recordTurnEvent(state, {
      type: "tool.finished",
      invocationId: "call_1",
      callId: "call_1",
      toolName: "readFile",
      result: "ok",
      resultDetail: "src/app.ts",
      timestamp: createTurnTimestamp(4),
    });

    const snapshot = buildTurnActivitySnapshot(state, { isCompacting: false, startedAt: 2 });
    expect(snapshot?.step?.label).toBe("reviewing the code");
    expect(snapshot?.step?.status).toBe("done");
    expect(snapshot?.tools).toHaveLength(1);
    expect(snapshot?.tools[0]?.status).toBe("done");
    expect(snapshot?.tools[0]?.args).toEqual({ path: "src/app.ts", mode: "full" });
  });
});
