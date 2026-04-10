import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";

describe("live activity architecture", () => {
  it("derives persisted activity from the live summary plus tool list instead of a separate mutable step", () => {
    const app = new App() as any;
    app.messages = [{ role: "assistant", content: "Working..." }];

    app.setStreaming(true);
    app.setStreamingActivitySummary("reviewing the code");
    app.addToolCall("readFile", "src/app.ts", { path: "src/app.ts" }, "call-1");
    app.addToolResult("readFile", "ok", false, "src/app.ts", "call-1");
    app.setStreaming(false);

    expect(app.currentActivityStep).toBeNull();
    expect(app.toolExecutions).toEqual([]);
    expect(app.messages[0].activity?.step?.label).toBe("reviewing the code");
    expect(app.messages[0].activity?.tools).toHaveLength(1);
    expect(app.messages[0].activity?.step?.status).toBe("done");
  });
});
