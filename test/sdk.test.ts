import { describe, expect, it } from "vitest";
import { createAgentSession, createAgentSessionRuntime } from "../src/sdk.js";

describe("sdk runtime", () => {
  it("creates a runtime and manages sessions locally", () => {
    const runtime = createAgentSessionRuntime({ autoSaveSessions: false });
    const firstId = runtime.session.getId();
    runtime.session.addMessage("user", "hello");
    const forked = runtime.fork();
    expect(forked.getId()).not.toBe(firstId);
    const fresh = runtime.newSession();
    expect(fresh.getMessages()).toHaveLength(0);
  });

  it("exposes direct session helpers", () => {
    const session = createAgentSession({ autoSaveSessions: false });
    expect(session.getMessages()).toHaveLength(0);
  });
});
