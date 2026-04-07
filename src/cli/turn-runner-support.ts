import { modelSupportsReasoning } from "../ai/model-catalog.js";
import type { ModelHandle } from "../ai/providers.js";

const SDK_TOOL_PROVIDER_IDS = new Set([
  "anthropic", "openai", "codex", "google", "mistral", "groq", "xai",
  "openrouter", "ollama", "lmstudio", "llamacpp", "jan", "vllm",
]);

export function supportsThinking(model: ModelHandle): boolean {
  return modelSupportsReasoning(model.modelId, model.provider.id);
}

export function shouldRequestThinkTags(model: ModelHandle, thinkingRequested: boolean): boolean {
  return thinkingRequested && supportsThinking(model) && model.runtime === "sdk";
}

export function canUseSdkTools(model: ModelHandle): boolean {
  return model.runtime === "sdk" && !!model.model && SDK_TOOL_PROVIDER_IDS.has(model.provider.id);
}

export function looksLikeRawToolPayload(nextText: string): boolean {
  const normalized = nextText.trimStart();
  return /^<tool_call>/i.test(normalized)
    || /^call:(writeFile|editFile|readFile|listFiles|grep|bash)\s*\{/i.test(normalized)
    || /^(writeFile|editFile|readFile|listFiles|grep|bash)\s*\(/i.test(normalized);
}

export function shouldSuppressPlanningNarration(nextText: string, policy: { archetype: string }): boolean {
  if (policy.archetype !== "edit" && policy.archetype !== "bugfix") return false;
  const normalized = nextText.trimStart().toLowerCase();
  return normalized.startsWith("using ")
    || normalized.startsWith("first step")
    || normalized.startsWith("need ")
    || normalized.startsWith("i'm checking")
    || normalized.startsWith("i am checking")
    || normalized.startsWith("checking ")
    || normalized.startsWith("reading ")
    || normalized.startsWith("looking ")
    || normalized.startsWith("inspecting ")
    || normalized.startsWith("i'll ")
    || normalized.startsWith("i will ")
    || normalized.startsWith("let me ")
    || normalized.startsWith("design dir")
    || normalized.startsWith("repo read next")
    || normalized.startsWith("before editing")
    || normalized.startsWith("before recreating")
    || normalized.startsWith("i need to");
}

export function formatTurnErrorMessage(options: {
  message: string;
  providerName: string;
  executionModelId: string;
}): string {
  const { providerName, executionModelId } = options;
  let msg = options.message;
  if (msg.includes("insufficient permissions") || msg.includes("Missing scopes")) {
    msg = "Your API key doesn't have access to this model. Try a different model with /model.";
  } else if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key") || msg.includes("401")) {
    msg = `Invalid API key for ${providerName}. Check your key and try again.`;
  } else if (msg.includes("Could not resolve") || msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    msg = `Can't reach ${providerName}. Check your connection or if the server is running.`;
  } else if (msg.includes("429") || msg.includes("rate_limit") || msg.includes("hit your limit")) {
    msg = "Rate limited. Wait a moment and try again.";
  } else if (msg.includes("is not supported when using Codex with a ChatGPT account")) {
    msg = `Codex ChatGPT login does not support model "${executionModelId}". Use a supported GPT-5 model, or turn off Auto-route for Codex native login.`;
  } else if (msg.includes("model_not_found") || msg.includes("does not exist") || msg.includes("not found")) {
    msg = `Model "${executionModelId}" not available. Try /model to pick a different one.`;
  } else if (msg.includes("overloaded") || msg.includes("503") || msg.includes("529")) {
    msg = `${providerName} is overloaded right now. Try again in a moment.`;
  }
  return msg.length > 300 ? `${msg.slice(0, 297)}...` : msg;
}

export function buildToolPreview(name: string, args: unknown): string {
  if (name === "agent") return (args as any)?.prompt ?? (args as any)?.task ?? "";
  if (name === "writeFile" || name === "editFile") return (args as any)?.path ?? "?";
  if (name === "readFile" || name === "listFiles" || name === "grep") return (args as any)?.path ?? (args as any)?.pattern ?? "?";
  if (name === "semSearch") return (args as any)?.query ?? (args as any)?.path ?? "?";
  if (name === "bash") {
    const command = (args as any)?.command ?? "?";
    return command.length > 60 ? `${command.slice(0, 57)}...` : command;
  }
  return typeof args === "object" ? JSON.stringify(args).slice(0, 50) : String(args).slice(0, 50);
}
