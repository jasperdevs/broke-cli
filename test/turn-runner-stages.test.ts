import { describe, expect, it, vi } from "vitest";
import { Session } from "../src/core/session.js";
import {
  addUserTurnToSession,
  selectMessagesForTurn,
  shouldRetryOnMainModel,
  shouldRetryWithToolRequirement,
} from "../src/cli/turn-runner-stages.js";

describe("turn runner stages", () => {
  it("keeps casual history windows bounded", () => {
    const messages = [
      { role: "user" as const, content: "1" },
      { role: "assistant" as const, content: "2" },
      { role: "user" as const, content: "3" },
    ];
    const selected = selectMessagesForTurn(messages, { promptProfile: "casual", historyWindow: 2 }, vi.fn(() => messages));
    expect(selected.map((entry) => entry.content)).toEqual(["2", "3"]);
  });

  it("enforces a deterministic replay budget while preserving the compaction summary", () => {
    const summary = "The conversation history before this point was compacted into the following summary:\n\n<summary>\nolder context";
    const messages = [
      { role: "user" as const, content: summary },
      { role: "assistant" as const, content: "a".repeat(1500) },
      { role: "user" as const, content: "b".repeat(1500) },
      { role: "assistant" as const, content: "c".repeat(1500) },
    ];
    const selected = selectMessagesForTurn(
      messages,
      { promptProfile: "full", historyWindow: null },
      vi.fn(() => messages),
      { maxTokens: 3, modelId: "test" },
    );

    expect(selected[0]?.content).toBe(summary);
    expect(selected.map((entry) => entry.content)).toEqual([summary, "c".repeat(1500)]);
  });

  it("keeps file context ephemeral when capturing the user turn", () => {
    const session = new Session(`turn-stage-${Date.now()}`);
    const app = {
      addMessage: vi.fn(),
      getFileContexts: () => new Map([["src/app.ts", "const x = 1;"]]),
    };

    const first = addUserTurnToSession({ app, session, text: "inspect this", effectiveImages: undefined, alreadyAddedUserMessage: false });

    expect(app.addMessage).toHaveBeenCalledWith("user", "inspect this", undefined);
    expect(session.getMessages()[0]?.content).toContain("[attached file context available only for this turn]");
    expect(session.getMessages()[0]?.content).not.toContain("--- @src/app.ts ---");
    expect(first.transientUserContext).toContain("--- @src/app.ts ---");

    addUserTurnToSession({ app, session, text: "inspect this", effectiveImages: undefined, alreadyAddedUserMessage: true });
    expect(session.getMessages()).toHaveLength(1);
  });

  it("keeps follow-up recent-edit context state-first instead of replaying file snippets", () => {
    const session = new Session(`turn-stage-followup-${Date.now()}`);
    session.recordRepoEdit("src/flags.js", "edit");
    const app = {
      addMessage: vi.fn(),
      getFileContexts: () => new Map<string, string>(),
    };

    const result = addUserTurnToSession({
      app,
      session,
      text: "Add node:test coverage for the flags fix.",
      effectiveImages: undefined,
      alreadyAddedUserMessage: false,
    });

    expect(session.getMessages()[0]?.content).toContain("[recent edits available only for this turn]");
    expect(result.transientUserContext).toContain("Recent edited files from the last turn: src/flags.js");
    expect(result.transientUserContext).toContain("Reuse repo state first.");
    expect(result.transientUserContext).not.toContain("--- @recent-edit:");
  });

  it("injects deterministic target-file context for explicit bugfixes", () => {
    const session = new Session(`turn-stage-target-${Date.now()}`);
    const app = {
      addMessage: vi.fn(),
      getFileContexts: () => new Map<string, string>(),
    };

    const result = addUserTurnToSession({
      app,
      session,
      text: "Fix src/core/context.ts so buildCorePrompt stays brief.",
      effectiveImages: undefined,
      alreadyAddedUserMessage: false,
    });

    expect(result.transientUserContext).toContain("--- @target:src/core/context.ts ---");
    expect(result.transientUserContext).toContain("Known target files for this task");
  });

  it("does not load semantic target context from paths outside the workspace", () => {
    const session = new Session(`turn-stage-outside-${Date.now()}`);
    const app = {
      addMessage: vi.fn(),
      getFileContexts: () => new Map<string, string>(),
    };

    const result = addUserTurnToSession({
      app,
      session,
      text: "Fix ../secrets.txt so it is valid.",
      effectiveImages: undefined,
      alreadyAddedUserMessage: false,
    });

    expect(result.transientUserContext).toBeUndefined();
  });

  it("recognizes the tool-requirement retry condition", () => {
    expect(shouldRetryWithToolRequirement({
      completion: "insufficient",
      resolvedRoute: "main",
      toolActivity: false,
    })).toBe(true);
    expect(shouldRetryWithToolRequirement({
      completion: "insufficient",
      resolvedRoute: "main",
      toolActivity: true,
    })).toBe(false);
  });

  it("recognizes the small-model fallback retry condition", () => {
    expect(shouldRetryOnMainModel({
      completion: "empty",
      resolvedRoute: "small",
      toolActivity: false,
    })).toBe(true);
    expect(shouldRetryOnMainModel({
      completion: "error",
      resolvedRoute: "small",
      toolActivity: false,
    })).toBe(true);
    expect(shouldRetryOnMainModel({
      completion: "success",
      resolvedRoute: "small",
      toolActivity: false,
    })).toBe(false);
  });
});
