import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const codexOutputSchemaCache = new Map<number, string>();

export function getCodexOutputSchemaPath(maxChars: number): string {
  const cached = codexOutputSchemaCache.get(maxChars);
  if (cached) return cached;
  const dir = join(tmpdir(), "brokecli-output-schemas");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `codex-final-${maxChars}.schema.json`);
  writeFileSync(path, JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: {
      answer: {
        type: "string",
        maxLength: maxChars,
      },
    },
  }), "utf8");
  codexOutputSchemaCache.set(maxChars, path);
  return path;
}

export function parseStructuredFinalText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    return answer || trimmed;
  } catch {
    return trimmed;
  }
}
