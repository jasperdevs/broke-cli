const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

interface ModelPricing {
  input: number;  // cost per 1M tokens
  output: number; // cost per 1M tokens
}

/** Fallback pricing (USD per 1M tokens) — used when LiteLLM fetch fails */
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6":          { input: 3.00,  output: 15.00 },
  "claude-opus-4-6":            { input: 5.00,  output: 25.00 },
  "claude-haiku-4-5-20251001":  { input: 1.00,  output: 5.00  },
  "gpt-4o-mini":                { input: 0.15,  output: 0.60  },
  "gpt-4o":                     { input: 2.50,  output: 10.00 },
  "gpt-4.1-mini":               { input: 0.40,  output: 1.60  },
  "gpt-4.1":                    { input: 2.00,  output: 8.00  },
  "o3-mini":                    { input: 1.10,  output: 4.40  },
};

let pricingCache: Record<string, ModelPricing> | null = null;

/** Fetch latest pricing from LiteLLM. Cached after first call. */
export async function loadPricing(): Promise<void> {
  if (pricingCache) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(LITELLM_PRICING_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as Record<string, {
      input_cost_per_token?: number;
      output_cost_per_token?: number;
    }>;

    pricingCache = {};
    for (const [key, info] of Object.entries(data)) {
      if (info.input_cost_per_token != null && info.output_cost_per_token != null) {
        // LiteLLM stores per-token, convert to per-1M tokens
        pricingCache[key] = {
          input: info.input_cost_per_token * 1_000_000,
          output: info.output_cost_per_token * 1_000_000,
        };
      }
    }
  } catch {
    // Silently fall back to hardcoded pricing
    pricingCache = { ...FALLBACK_PRICING };
  }
}

function getPricing(model: string): ModelPricing {
  const cache = pricingCache ?? FALLBACK_PRICING;
  // Direct match
  if (cache[model]) return cache[model];
  // Try with common provider prefixes (LiteLLM uses "anthropic/", "openai/", etc.)
  for (const prefix of ["anthropic/", "openai/", "google/", "groq/", "mistral/", ""]) {
    const key = prefix + model;
    if (cache[key]) return cache[key];
  }
  // Fuzzy: try if model ID is a substring of a cache key
  for (const [key, val] of Object.entries(cache)) {
    if (key.endsWith("/" + model) || key === model) return val;
  }
  return { input: 0, output: 0 };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): TokenUsage {
  const pricing = getPricing(model);
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost,
  };
}

export function isLocalModel(model: string): boolean {
  const pricing = getPricing(model);
  return pricing.input === 0 && pricing.output === 0;
}
