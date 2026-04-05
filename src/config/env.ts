/**
 * Map BROKECLI_* environment variables to config overrides.
 * Convention: BROKECLI_SECTION_KEY maps to config.section.key
 */
export function envOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const prefix = "BROKECLI_";

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;

    const path = key
      .slice(prefix.length)
      .toLowerCase()
      .split("_");

    if (path.length === 2) {
      const [section, prop] = path;
      if (!overrides[section]) overrides[section] = {};
      (overrides[section] as Record<string, unknown>)[prop] = parseEnvValue(value);
    }
  }

  return overrides;
}

function parseEnvValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") return num;
  return value;
}
