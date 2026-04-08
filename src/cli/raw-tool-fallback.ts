import { LOCAL_PROVIDER_IDS, type ModelHandle } from "../ai/provider-definitions.js";
import type { ToolName } from "../tools/registry.js";
import { buildToolPreview, canUseSdkTools } from "./turn-runner-support.js";
import { parseToolCallsFromText } from "../utils/parse-tool-calls.js";
import { observeToolResult } from "./turn-tool-observer.js";
import type { Session } from "../core/session.js";

function inferExplicitPathFromText(text: string): string | undefined {
  return text.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g)?.[0];
}

function summarizeParsedToolExecution(name: string, args: Record<string, unknown>, result: unknown): string {
  const success = typeof result === "object" && result !== null ? (result as Record<string, unknown>).success !== false : true;
  if (!success) return `${name} failed.`;
  const path = typeof args.path === "string" ? args.path : "";
  if (name === "writeFile" && path) return `${path} created.`;
  if (name === "editFile" && path) return `${path} updated.`;
  if (name === "readFile" && path) return `${path} read.`;
  if (name === "listFiles") return "Listed files.";
  if (name === "grep") return "Searched files.";
  if (name === "bash") return "Command ran.";
  return `${name} ran.`;
}

export async function executeRawToolPayloadFallback(options: {
  rawToolPayloadText: string | null;
  text: string;
  executionModel: ModelHandle;
  policyAllowedTools: readonly ToolName[];
  buildTools: (allowedTools: readonly ToolName[]) => Record<string, unknown>;
  app: {
    addToolCall(name: string, preview: string): void;
    updateToolCallArgs(name: string, preview: string, args?: unknown): void;
    addToolResult(name: string, result: string, error?: boolean, detail?: string): void;
  };
  hooks: { emit(event: string, payload: Record<string, unknown>): void };
  session: Session;
  nextToolCalls: string[];
  abortSignal?: AbortSignal;
}): Promise<{ handled: boolean; summary?: string }> {
  const {
    rawToolPayloadText,
    text,
    executionModel,
    policyAllowedTools,
    buildTools,
    app,
    hooks,
    session,
    nextToolCalls,
    abortSignal,
  } = options;
  if (!rawToolPayloadText) return { handled: false };
  if (executionModel.runtime !== "sdk" || !LOCAL_PROVIDER_IDS.has(executionModel.provider.id) || !canUseSdkTools(executionModel)) {
    return { handled: false };
  }

  const parsedCalls = parseToolCallsFromText(rawToolPayloadText)
    .filter((call) => policyAllowedTools.includes(call.name as ToolName));
  if (parsedCalls.length === 0) return { handled: false };

  const tools = buildTools(policyAllowedTools) as Record<string, { execute?: (args: Record<string, unknown>, options?: Record<string, unknown>) => unknown | Promise<unknown> }>;
  let lastSummary = "Tool ran.";

  for (const call of parsedCalls) {
    const executor = tools[call.name]?.execute;
    if (!executor) continue;
    if (typeof call.args.path !== "string" || !call.args.path) {
      const inferredPath = inferExplicitPathFromText(text);
      if (inferredPath) call.args.path = inferredPath;
    }
    nextToolCalls.push(call.name);
    hooks.emit("on_tool_call", { name: call.name, args: call.args });
    app.addToolCall(call.name, "...");
    app.updateToolCallArgs(call.name, buildToolPreview(call.name, call.args), call.args);
    try {
      const result = await executor(call.args, { abortSignal });
      hooks.emit("on_tool_result", { name: call.name, result });
      const detail = observeToolResult({
        session,
        toolName: call.name,
        result: result as Record<string, unknown>,
        toolArgs: call.args,
      });
      const failed = typeof result === "object" && result !== null && (result as Record<string, unknown>).success === false;
      const error = typeof result === "object" && result !== null && typeof (result as Record<string, unknown>).error === "string"
        ? ((result as Record<string, unknown>).error as string)
        : undefined;
      if (failed && error) app.addToolResult(call.name, error.slice(0, 80), true, detail);
      else app.addToolResult(call.name, "ok", false, detail);
      lastSummary = summarizeParsedToolExecution(call.name, call.args, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.addToolResult(call.name, message.slice(0, 80), true);
      lastSummary = `${call.name} failed.`;
    }
  }

  return { handled: true, summary: lastSummary };
}
