import { Command } from "commander";
import { App } from "../src/tui/app.js";

const program = new Command()
  .name("brokecli")
  .description("AI coding CLI that doesn't waste your money")
  .version("0.0.1")
  .option("--broke", "Route to cheapest capable model")
  .option("-m, --model <model>", "Model to use (provider/model-id)")
  .option("-p, --print", "Single-shot mode: print response and exit");

program.action((_opts) => {
  const app = new App();

  app.onInput((text) => {
    // Handle slash commands
    if (text.startsWith("/")) {
      const [cmd, ...args] = text.slice(1).split(" ");
      switch (cmd) {
        case "help":
          app.addMessage("system", [
            "Commands:",
            "  /model      — show/switch model",
            "  /cost       — show session cost",
            "  /clear      — clear chat",
            "  /help       — this help",
            "  ctrl+c ×2   — exit",
          ].join("\n"));
          return;
        case "clear":
          // TODO: clear messages
          app.addMessage("system", "Chat cleared.");
          return;
        case "cost":
          app.addMessage("system", "Cost tracking coming in Phase 2.");
          return;
        case "model":
          app.addMessage("system", "Model switching coming in Phase 2.");
          return;
        default:
          app.addMessage("system", `Unknown command: /${cmd}. Try /help`);
          return;
      }
    }

    // Echo for now — Phase 2 will wire up AI SDK
    app.addMessage("user", text);
    app.addMessage("assistant", `[Phase 2 will connect to LLM] You said: ${text}`);
  });

  app.start();
});

program.parse();
