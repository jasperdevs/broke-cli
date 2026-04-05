import { Command } from "commander";
import { version, description } from "../package.json";
import { run } from "../src/cli.js";

const program = new Command()
  .name("brokecli")
  .description(description)
  .version(version)
  .option("--broke", "Route to cheapest capable model")
  .option("-m, --model <model>", "Model to use (provider/model-id)")
  .option("-p, --print", "Single-shot mode: print response and exit")
  .option("--mode <mode>", "Output mode: interactive, json, rpc", "interactive")
  .option("--config <path>", "Path to config file");

program
  .command("config")
  .description("Show resolved configuration")
  .command("show")
  .description("Print merged config from all sources")
  .action(async () => {
    const { showConfig } = await import("../src/config/loader.js");
    await showConfig();
  });

program
  .command("config-path")
  .description("Show config file locations")
  .action(async () => {
    const { showPaths } = await import("../src/config/paths.js");
    showPaths();
  });

program.action(async (opts) => {
  await run(opts);
});

program.parse();
