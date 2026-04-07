import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export function isSkippedPromptAnswer(value: string | undefined | null): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "[user skipped]" || normalized === "[no answer]";
}

export function isValidHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.host;
  } catch {
    return false;
  }
}

export function normalizeThinkingLevel(level: string | undefined): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
  if (!level) return undefined;
  const normalized = level.trim().toLowerCase();
  if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(normalized)) {
    return normalized as "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  }
  return undefined;
}

export function splitModelArg(modelArg: string | undefined): { provider?: string; model?: string; thinking?: string } {
  if (!modelArg) return {};
  const [rawModel, thinking] = modelArg.split(":");
  const parts = rawModel.split("/");
  if (parts.length === 2) return { provider: parts[0], model: parts[1], thinking };
  return { model: rawModel, thinking };
}

export async function readPromptArg(promptParts: string[]): Promise<string> {
  const stdinChunks: Buffer[] = [];
  if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) stdinChunks.push(Buffer.from(chunk));
  }
  const stdinText = stdinChunks.length > 0 ? Buffer.concat(stdinChunks).toString("utf-8").trim() : "";
  const promptSegments = promptParts.map((part) => {
    if (!part.startsWith("@")) return part;
    const filePath = resolve(part.slice(1));
    if (!existsSync(filePath)) return part;
    try {
      return `--- @${part.slice(1)} ---\n${readFileSync(filePath, "utf-8")}`;
    } catch {
      return part;
    }
  }).filter(Boolean);
  const joinedPrompt = promptSegments.join(" ").trim();
  if (joinedPrompt && stdinText) return `${joinedPrompt}\n\n${stdinText}`;
  if (joinedPrompt) return joinedPrompt;
  if (stdinText) return stdinText;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8").trim();
}

export function normalizeProgramArgv(argv: string[]): string[] {
  return argv.map((arg) => (arg === "--session" ? "--session-id" : arg));
}
