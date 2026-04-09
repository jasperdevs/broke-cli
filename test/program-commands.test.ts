import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/program.js";

describe("program commands", () => {
  it("registers benchmark entrypoints", () => {
    const program = createProgram("0.0.0-test");
    const commandNames = program.commands.map((command) => command.name());
    expect(commandNames).toContain("benchmark");
    expect(commandNames).toContain("benchmark-tasks");
  });
});
