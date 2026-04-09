import {
  extractClaudeContentBlocks,
  extractItemType,
  extractNativeToolArgs,
  extractNativeToolCallId,
  extractNativeToolName,
  extractNativeToolResult,
  parsePossiblyPartialJson,
} from "./native-tool-events.js";

type HandlerCallbacks = {
  onText: (delta: string) => void;
  onReasoning: (delta: string) => void;
  onToolCallStart?: (toolName: string, callId?: string) => void;
  onToolCall?: (toolName: string, args: unknown, callId?: string) => void;
  onToolResult?: (toolName: string, result: unknown, callId?: string) => void;
  onAfterToolCall?: () => void;
};

function extractClaudeText(message: unknown, blockType: "text" | "thinking"): string {
  const record = typeof message === "object" && message !== null ? message as Record<string, unknown> : {};
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .filter((block) => {
      const kind = typeof block === "object" && block !== null ? (block as Record<string, unknown>).type : undefined;
      return kind === blockType;
    })
    .map((block) => {
      const text = typeof block === "object" && block !== null ? (block as Record<string, unknown>).text : undefined;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function extractCodexItemText(item: unknown): string {
  const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.content)) {
    return record.content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).text === "string") {
          return (entry as Record<string, unknown>).text as string;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function extractClaudeToolUseNames(message: unknown): string[] {
  const record = typeof message === "object" && message !== null ? message as Record<string, unknown> : {};
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .filter((block) => typeof block === "object" && block !== null && (block as Record<string, unknown>).type === "tool_use")
    .map((block) => {
      const name = (block as Record<string, unknown>).name;
      return typeof name === "string" && name.trim() ? name : "a tool";
    });
}

function emitDelta(next: string, previous: string, emit: (delta: string) => void): string {
  if (!next) return previous;
  if (next.startsWith(previous)) {
    const delta = next.slice(previous.length);
    if (delta) emit(delta);
  } else {
    emit(next);
  }
  return next;
}

export function createNativeEventHandlers(options: {
  providerId: "anthropic" | "codex";
  denyToolUse?: boolean;
  structuredFinalResponse?: { maxChars: number } | null;
  callbacks: HandlerCallbacks;
  fail: (message: string) => void;
  finishWithUsage: (usageData?: unknown) => void;
  parseStructuredFinalText: (raw: string) => string;
}) {
  const { providerId, denyToolUse, structuredFinalResponse, callbacks, fail, finishWithUsage, parseStructuredFinalText } = options;
  let emittedText = "";
  let visibleText = "";
  let emittedReasoning = "";
  const nativeToolNamesById = new Map<string, string>();
  const nativeToolArgsById = new Map<string, string>();
  const startedToolIds = new Set<string>();

  const startToolIfNeeded = (toolName: string, toolCallId: string | null) => {
    if (!toolCallId) {
      callbacks.onToolCallStart?.(toolName);
      return;
    }
    if (startedToolIds.has(toolCallId)) return;
    startedToolIds.add(toolCallId);
    callbacks.onToolCallStart?.(toolName, toolCallId);
  };

  const handleCodexEvent = (event: Record<string, unknown>) => {
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "response.output_item.added") {
      const item = typeof event.item === "object" && event.item !== null ? event.item as Record<string, unknown> : {};
      const itemType = extractItemType(item);
      const toolName = extractNativeToolName(item);
      const toolCallId = extractNativeToolCallId(item);
      if (toolName && /function_call/.test(itemType)) {
        if (toolCallId) nativeToolNamesById.set(toolCallId, toolName);
        startToolIfNeeded(toolName, toolCallId);
        const args = extractNativeToolArgs(item);
        if (typeof args === "object" && args !== null && Object.keys(args as Record<string, unknown>).length > 0) {
          callbacks.onToolCall?.(toolName, args, toolCallId ?? undefined);
        }
        return;
      }
    }
    if (type === "response.function_call_arguments.delta" || type === "response.function_call_arguments.done") {
      const toolCallId = typeof event.item_id === "string" && event.item_id.trim()
        ? event.item_id.trim()
        : typeof event.call_id === "string" && event.call_id.trim()
          ? event.call_id.trim()
          : "";
      if (!toolCallId) return;
      const toolName = nativeToolNamesById.get(toolCallId) ?? "tool";
      startToolIfNeeded(toolName, toolCallId);
      const previous = nativeToolArgsById.get(toolCallId) ?? "";
      const nextRaw = type === "response.function_call_arguments.done"
        ? (typeof event.arguments === "string" ? event.arguments : previous)
        : `${previous}${typeof event.delta === "string" ? event.delta : ""}`;
      nativeToolArgsById.set(toolCallId, nextRaw);
      callbacks.onToolCall?.(toolName, parsePossiblyPartialJson(nextRaw), toolCallId);
      return;
    }
    if (type === "response.output_item.done") {
      const item = typeof event.item === "object" && event.item !== null ? event.item as Record<string, unknown> : {};
      const itemType = extractItemType(item);
      const toolName = extractNativeToolName(item);
      const toolCallId = extractNativeToolCallId(item);
      if (toolName && /function_call/.test(itemType)) {
        if (toolCallId) nativeToolNamesById.set(toolCallId, toolName);
        startToolIfNeeded(toolName, toolCallId);
        callbacks.onToolCall?.(toolName, extractNativeToolArgs(item), toolCallId ?? undefined);
        return;
      }
    }
    if (type === "response.completed") {
      finishWithUsage((event.response as Record<string, unknown> | undefined)?.usage);
      return;
    }
    if (type === "item.completed") {
      const item = typeof event.item === "object" && event.item !== null ? event.item as Record<string, unknown> : {};
      const itemType = extractItemType(item);
      if (denyToolUse && itemType.includes("tool")) {
        fail("Side question attempted to use a tool.");
        return;
      }
      const toolName = extractNativeToolName(item);
      const toolCallId = extractNativeToolCallId(item);
      const text = extractCodexItemText(item);
      if (toolName && toolCallId) nativeToolNamesById.set(toolCallId, toolName);
      if (toolName && /tool|function/.test(itemType) && /(call|use|invocation|request|input|start)/.test(itemType)) {
        startToolIfNeeded(toolName, toolCallId);
        callbacks.onToolCall?.(toolName, extractNativeToolArgs(item), toolCallId ?? undefined);
      }
      if (toolName && /tool|function/.test(itemType) && /(result|output|response)/.test(itemType)) {
        callbacks.onToolResult?.(toolName, extractNativeToolResult(item, text), toolCallId ?? undefined);
        callbacks.onAfterToolCall?.();
      }
      if ((itemType === "agent_message" || itemType === "message") && text) {
        emittedText = text;
        if (!structuredFinalResponse) visibleText = emitDelta(text, visibleText, callbacks.onText);
      }
      if (itemType.includes("reason") && text) {
        emittedReasoning = emitDelta(text, emittedReasoning, callbacks.onReasoning);
      }
      return;
    }
    if (type === "turn.completed") {
      if (structuredFinalResponse) {
        const parsed = parseStructuredFinalText(emittedText);
        visibleText = emitDelta(parsed, visibleText, callbacks.onText);
        emittedText = parsed;
      }
      finishWithUsage(event.usage);
      return;
    }
    if (type === "error") {
      fail(typeof event.message === "string" ? event.message : "Codex stream failed");
    }
  };

  const handleClaudeEvent = (event: Record<string, unknown>) => {
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "assistant") {
      const message = typeof event.message === "object" && event.message !== null ? event.message : null;
      if (denyToolUse) {
        const toolNames = extractClaudeToolUseNames(message);
        if (toolNames.length > 0) {
          fail(`Side question attempted to use ${toolNames.join(", ")}.`);
          return;
        }
      }
      const toolUses = extractClaudeContentBlocks(message, "tool_use");
      for (const block of toolUses) {
        const name = typeof block.name === "string" && block.name.trim() ? block.name.trim() : "tool";
        const toolUseId = typeof block.id === "string" && block.id.trim() ? block.id.trim() : null;
        if (toolUseId) nativeToolNamesById.set(toolUseId, name);
        startToolIfNeeded(name, toolUseId);
        callbacks.onToolCall?.(name, block.input ?? {}, toolUseId ?? undefined);
      }
      const text = extractClaudeText(message, "text");
      const reasoning = extractClaudeText(message, "thinking");
      if (text) emittedText = emitDelta(text, emittedText, callbacks.onText);
      if (reasoning) emittedReasoning = emitDelta(reasoning, emittedReasoning, callbacks.onReasoning);
      return;
    }
    if (type === "user") {
      const message = typeof event.message === "object" && event.message !== null ? event.message : null;
      const toolResults = extractClaudeContentBlocks(message, "tool_result");
      for (const block of toolResults) {
        const toolUseId = typeof block.tool_use_id === "string" && block.tool_use_id.trim() ? block.tool_use_id.trim() : "";
        const name = nativeToolNamesById.get(toolUseId) ?? "tool";
        callbacks.onToolResult?.(name, block.content ?? "", toolUseId || undefined);
        callbacks.onAfterToolCall?.();
      }
      return;
    }
    if (type === "result") {
      const isError = event.is_error === true;
      const resultText = typeof event.result === "string" ? event.result : "";
      if (isError) {
        fail(resultText || "Claude stream failed");
        return;
      }
      finishWithUsage(event.usage);
    }
  };

  return {
    handleJsonEvent(event: Record<string, unknown>) {
      if (providerId === "anthropic") handleClaudeEvent(event);
      else handleCodexEvent(event);
    },
    getCombinedOutputText() {
      return emittedText + emittedReasoning;
    },
  };
}
