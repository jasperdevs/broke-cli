import { loadConfig } from "./config/loader.js";

export interface CliOptions {
  broke?: boolean;
  model?: string;
  print?: boolean;
  mode?: string;
  config?: string;
}

export async function run(opts: CliOptions): Promise<void> {
  const config = await loadConfig(opts.config);

  // Phase 0: just print what we loaded
  console.log("brokecli - AI coding CLI that doesn't waste your money.");
  console.log("");
  console.log("Detected providers:");

  const providers = detectProviders(config);
  if (providers.length === 0) {
    console.log("  (none) - set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY");
  } else {
    for (const p of providers) {
      console.log(`  - ${p}`);
    }
  }

  console.log("");
  console.log("Run brokecli --help for usage.");
}

function detectProviders(config: Record<string, unknown>): string[] {
  const providers: string[] = [];
  const env = process.env;

  if (env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (env.OPENAI_API_KEY) providers.push("openai");
  if (env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY) providers.push("google");
  if (env.OPENROUTER_API_KEY) providers.push("openrouter");
  if (env.GROQ_API_KEY) providers.push("groq");

  // Check config file providers
  const configProviders = (config as { providers?: Record<string, unknown> }).providers;
  if (configProviders) {
    for (const [name, entry] of Object.entries(configProviders)) {
      const p = entry as { apiKey?: string; enabled?: boolean };
      if (p.enabled !== false && p.apiKey && !providers.includes(name)) {
        providers.push(name);
      }
    }
  }

  return providers;
}
