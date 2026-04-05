import React from "react";
import { render } from "ink";
import { loadConfig } from "./config/loader.js";
import { detectAllProviders, type DetectionResult } from "./providers/detect.js";
import { buildProviders, findModel } from "./providers/registry.js";
import { App } from "./ui/app.js";
import { EXIT_LINES } from "./ui/mascot.js";
import type { Provider, ModelInfo } from "./providers/types.js";

export interface CliOptions {
  broke?: boolean;
  model?: string;
  print?: boolean;
  mode?: string;
  config?: string;
}

export async function run(opts: CliOptions): Promise<void> {
  const config = await loadConfig(opts.config);

  // Detect all available providers (env, config, oauth, local servers)
  const detected = await detectAllProviders(config.providers);
  const providers = buildProviders(
    detected
      .filter((d) => d.apiKey)
      .map((d) => ({
        id: d.id,
        name: d.name,
        isLocal: d.method === "local",
        apiKey: d.apiKey,
        baseUrl: d.baseUrl,
        availableModels: [],
      })),
  );

  // Resolve initial model if providers exist
  let initialProvider: Provider | undefined;
  let initialModel: ModelInfo | undefined;

  if (providers.length > 0) {
    const modelSpec = opts.model ?? config.routing.defaultModel ?? undefined;

    if (modelSpec) {
      const resolved = findModel(providers, modelSpec);
      if (resolved) {
        initialProvider = resolved.provider;
        initialModel = resolved.model;
      }
    } else {
      initialProvider = providers[0];
      initialModel = providers[0].listModels()[0];
    }
  }

  // Enter alternate screen buffer (fullscreen TUI)
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[H\x1b[2J");

  const restore = () => {
    process.stdout.write("\x1b[?1049l");
    // Show exit mascot (like OpenCode shows its logo on exit)
    for (const line of EXIT_LINES) {
      process.stdout.write(line + "\n");
    }
  };

  process.on("exit", restore);
  process.on("SIGINT", () => { restore(); process.exit(0); });
  process.on("SIGTERM", () => { restore(); process.exit(0); });

  const { waitUntilExit } = render(
    React.createElement(App, {
      provider: initialProvider,
      model: initialModel,
      providers,
      detectedProviders: detected,
    }),
  );

  await waitUntilExit();
}
