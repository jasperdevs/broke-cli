import React from "react";
import { render } from "ink";
import { loadConfig } from "./config/loader.js";
import { detectProviders, buildProviders, findModel } from "./providers/registry.js";
import { App } from "./ui/app.js";

export interface CliOptions {
  broke?: boolean;
  model?: string;
  print?: boolean;
  mode?: string;
  config?: string;
}

export async function run(opts: CliOptions): Promise<void> {
  const config = await loadConfig(opts.config);

  // Detect and build providers
  const detected = detectProviders(config.providers);

  if (detected.length === 0) {
    console.error("No providers configured.");
    console.error("Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY");
    console.error("Or add providers to ~/.brokecli/config.jsonc");
    process.exit(1);
  }

  const providers = buildProviders(detected);

  if (providers.length === 0) {
    console.error("Failed to initialize any providers.");
    process.exit(1);
  }

  // Resolve model
  const defaultModelSpec =
    opts.model ?? config.routing.defaultModel ?? undefined;

  let resolved: ReturnType<typeof findModel>;

  if (defaultModelSpec) {
    resolved = findModel(providers, defaultModelSpec);
    if (!resolved) {
      console.error(`Model not found: ${defaultModelSpec}`);
      console.error("Available models:");
      for (const p of providers) {
        for (const m of p.listModels()) {
          console.error(`  ${p.id}/${m.id} (${m.displayName})`);
        }
      }
      process.exit(1);
    }
  } else {
    // Use first model of first provider
    const provider = providers[0];
    const model = provider.listModels()[0];
    resolved = { provider, model };
  }

  // Render the Ink app
  const { waitUntilExit } = render(
    React.createElement(App, {
      provider: resolved.provider,
      model: resolved.model,
    }),
  );

  await waitUntilExit();
}
