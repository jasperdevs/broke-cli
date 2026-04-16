import { Command } from "commander";
import { registerPackageCommands } from "./package-commands.js";

export function createProgram(appVersion: string): Command {
  const program = new Command()
    .name("brokecli")
    .description("Terminal-first AI coding CLI with budget-aware model routing")
    .version(appVersion)
    .argument("[prompt...]", "Prompt to run in single-shot print/json mode")
    .option("--broke", "Route to cheapest capable model")
    .option("--provider <provider>", "Provider to use")
    .option("-m, --model <model>", "Model to use (provider/model-id)")
    .option("--api-key <key>", "Runtime API key override")
    .option("-c, --continue", "Continue last session")
    .option("-r, --resume", "Resume the most recent session")
    .option("--session-id <id>", "Open a specific saved session")
    .option("--fork <id>", "Fork from a specific saved session")
    .option("--session-dir <path>", "Override the session directory for this run")
    .option("-p, --print", "Single-shot mode: print response and exit")
    .option("--mode <mode>", "Output mode: tui, json, or rpc", "tui")
    .option("--tools <patterns>", "Comma-separated tool allowlist/excludes for this run")
    .option("--thinking <level>", "Thinking level: off, minimal, low, medium, high, xhigh")
    .option("--list-models [search]", "List visible models and exit")
    .option("--system-prompt <text>", "Replace the default system prompt for this run")
    .option("--append-system-prompt <text>", "Append to the system prompt for this run")
    .option("-e, --extension <source>", "Load extension path/package for this run", (value, acc: string[]) => [...acc, value], [])
    .option("--skill <source>", "Load skill path/package for this run", (value, acc: string[]) => [...acc, value], [])
    .option("--prompt-template <source>", "Load prompt template path/package for this run", (value, acc: string[]) => [...acc, value], [])
    .option("--no-extensions", "Disable extension discovery for this run")
    .option("--no-skills", "Disable skill discovery for this run")
    .option("--no-prompt-templates", "Disable prompt-template discovery for this run")
    .option("--export <session>", "Export a saved session to HTML")
    .option("--export-out <path>", "Output path for --export")
    .option("--verbose", "Force verbose startup")
    .option("--no-session", "Disable session persistence for this run")
    .option("--rpc", "Non-interactive JSON RPC mode");

  registerPackageCommands(program);
  return program;
}
