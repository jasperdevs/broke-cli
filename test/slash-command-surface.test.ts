import { describe, expect, it } from "vitest";
import { COMMANDS, getCommandMatches, resolveSlashCommandName } from "../src/tui/command-surface.js";

describe("slash command surface", () => {
  it("exposes /quit but not /exit", () => {
    expect(COMMANDS.some((command) => command.name === "quit")).toBe(true);
    expect(COMMANDS.some((command) => command.name === "exit")).toBe(false);
    expect(resolveSlashCommandName("/quit")).toBe("quit");
    expect(resolveSlashCommandName("/exit")).toBeNull();
    expect(getCommandMatches("/ex").some((command) => command.name === "quit")).toBe(false);
  });
});
