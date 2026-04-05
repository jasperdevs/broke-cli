import React from "react";
import { render } from "ink";
import { loadConfig } from "./config/loader.js";
import { detectProviders, buildProviders, findModel } from "./providers/registry.js";
import { App } from "./ui/app.js";
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

  // Detect and build providers — but don't fail if none found
  const detected = detectProviders(config.providers);
  const providers = buildProviders(detected);

  // Resolve model if providers exist
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

  // Always render the app — it handles the no-provider state
  const { waitUntilExit } = render(
    React.createElement(App, {
      provider: initialProvider,
      model: initialModel,
      providers,
    }),
  );

  await waitUntilExit();
}
