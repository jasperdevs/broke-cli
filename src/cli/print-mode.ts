import type { DetectedProvider } from "../ai/detect.js";
import { getSettings } from "../core/config.js";
import type { HookRegistry } from "../core/extensions.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import { runOneShotPrompt } from "./oneshot.js";
import { readPromptArg } from "./cli-helpers.js";

type ParsedModelArg = { provider?: string; model?: string };
type PrintModeOptions = {
  print?: boolean;
  mode?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
};

export async function runCliPrintOrJsonMode(options: {
  promptParts: string[];
  opts: PrintModeOptions;
  parsedModel: ParsedModelArg;
  providers: DetectedProvider[];
  providerRegistry: ProviderRegistry;
  hooks: HookRegistry;
  reportPackageInstallWarnings: () => void;
}): Promise<boolean> {
  const { promptParts, opts, parsedModel, providers, providerRegistry, hooks, reportPackageInstallWarnings } = options;
  if (!opts.print && opts.mode !== "json") return false;
  reportPackageInstallWarnings();
  const prompt = await readPromptArg(promptParts);
  if (!prompt) {
    console.error("No prompt provided for single-shot mode.");
    process.exit(1);
    return true;
  }
  const jsonMode = opts.mode === "json";
  const result = await runOneShotPrompt({
    prompt,
    mode: getSettings().mode,
    providers,
    providerRegistry,
    opts: {
      ...opts,
      provider: opts.provider ?? parsedModel.provider,
      model: opts.provider ? opts.model : (parsedModel.model ?? opts.model),
      systemPrompt: opts.systemPrompt,
      appendSystemPrompt: opts.appendSystemPrompt,
    },
    extraTools: hooks.getTools(),
    streamCallbacks: jsonMode ? {
      onStart: ({ providerId, modelId }) => process.stdout.write(`${JSON.stringify({ type: "start", provider: providerId, model: modelId })}\n`),
      onText: (delta) => process.stdout.write(`${JSON.stringify({ type: "text", delta })}\n`),
      onReasoning: (delta) => process.stdout.write(`${JSON.stringify({ type: "reasoning", delta })}\n`),
      onToolCall: ({ name, args }) => process.stdout.write(`${JSON.stringify({ type: "tool_call", name, args })}\n`),
      onToolResult: ({ name, result }) => process.stdout.write(`${JSON.stringify({ type: "tool_result", name, result })}\n`),
    } : undefined,
  });
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({
      type: "done",
      provider: result.providerId,
      model: result.modelId,
      usage: result.usage,
      session: {
        totalTokens: result.session.getTotalTokens(),
        inputTokens: result.session.getTotalInputTokens(),
        outputTokens: result.session.getTotalOutputTokens(),
        cost: result.session.getTotalCost(),
      },
      toolCalls: result.toolCalls,
    })}\n`);
  } else {
    process.stdout.write(`${result.content}\n`);
  }
  return true;
}
