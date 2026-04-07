import { describe, expect, it } from "vitest";
import { resolveExecutionTarget } from "../src/cli/turn-runner-support.js";
import { resolvePreferredMode, resolvePreferredSpecialistRole } from "../src/cli/model-routing.js";

const mainModel = {
  provider: { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-mini", models: ["gpt-5.4-mini"] },
  runtime: "sdk",
  model: {} as any,
  modelId: "gpt-5.4-mini",
};

const uiModel = {
  provider: { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4-6", models: ["claude-sonnet-4-6"] },
  runtime: "sdk",
  model: {} as any,
  modelId: "claude-sonnet-4-6",
};

describe("specialist model routing", () => {
  it("detects specialist roles from task shape", () => {
    expect(resolvePreferredSpecialistRole("polish the landing page spacing and typography", "edit")).toBe("ui");
    expect(resolvePreferredSpecialistRole("review this diff for bugs", "review")).toBe("review");
    expect(resolvePreferredSpecialistRole("plan the system boundaries for this migration", "planning")).toBe("architecture");
  });

  it("detects when a turn should switch between plan and build", () => {
    expect(resolvePreferredMode("plan the service boundaries for this migration", "planning", "build")).toEqual({
      mode: "plan",
      reason: "planning turn",
    });
    expect(resolvePreferredMode("fix the broken sidebar footer wrap", "bugfix", "plan")).toEqual({
      mode: "build",
      reason: "implementation turn",
    });
    expect(resolvePreferredMode("what file renders the sidebar", "explore", "build")).toBeNull();
  });

  it("routes UI-heavy main-lane work to the configured specialist model", () => {
    const resolved = resolveExecutionTarget({
      text: "make the dashboard spacing and typography feel polished",
      policy: {
        archetype: "edit",
        allowedTools: [],
        maxToolSteps: 2,
        scaffold: "lane main",
        scaffoldSource: "builtin",
        preferSmallExecutor: false,
        promptProfile: "full",
        historyWindow: null,
      },
      currentMode: "build",
      sessionMessageCount: 6,
      lastToolCalls: [],
      activeModel: mainModel as any,
      currentModelId: "gpt-5.4-mini",
      smallModel: null,
      smallModelId: "",
      resolveSpecialistModel: (role) => role === "ui"
        ? { model: uiModel as any, modelId: "claude-sonnet-4-6" }
        : null,
    });

    expect(resolved.resolvedRoute).toBe("main");
    expect(resolved.specialistRole).toBe("ui");
    expect(resolved.executionModelId).toBe("claude-sonnet-4-6");
  });

  it("prefers the plan slot model while plan mode is active", () => {
    const resolved = resolveExecutionTarget({
      text: "make a step-by-step plan for rolling this out safely",
      policy: {
        archetype: "planning",
        allowedTools: [],
        maxToolSteps: 2,
        scaffold: "lane cheap",
        scaffoldSource: "builtin",
        preferSmallExecutor: false,
        promptProfile: "full",
        historyWindow: null,
      },
      currentMode: "plan",
      sessionMessageCount: 4,
      lastToolCalls: [],
      activeModel: mainModel as any,
      currentModelId: "gpt-5.4-mini",
      smallModel: null,
      smallModelId: "",
      resolveSpecialistModel: (role) => role === "planning"
        ? { model: uiModel as any, modelId: "claude-sonnet-4-6" }
        : null,
    });

    expect(resolved.resolvedRoute).toBe("main");
    expect(resolved.specialistRole).toBe("planning");
    expect(resolved.executionModelId).toBe("claude-sonnet-4-6");
  });
});
