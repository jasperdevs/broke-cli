function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export function extractClaudeContentBlocks(message: unknown, blockType: string): Array<Record<string, unknown>> {
  const record = asRecord(message);
  const content = Array.isArray(record?.content) ? record.content : [];
  return content.filter((block) => asRecord(block)?.type === blockType) as Array<Record<string, unknown>>;
}

export function extractItemType(item: unknown): string {
  const record = asRecord(item);
  return typeof record?.type === "string"
    ? record.type
    : typeof record?.item_type === "string"
      ? record.item_type
      : "";
}

export function extractNativeToolName(item: unknown): string | null {
  const record = asRecord(item);
  const direct = [record?.name, record?.tool_name, record?.toolName, record?.call_name, record?.callName];
  for (const candidate of direct) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const fn = asRecord(record?.function);
  if (typeof fn?.name === "string" && fn.name.trim()) return fn.name.trim();
  return null;
}

export function extractNativeToolArgs(item: unknown): unknown {
  const record = asRecord(item);
  return record?.input ?? record?.args ?? record?.arguments ?? record?.parameters ?? {};
}

export function extractNativeToolResult(item: unknown, fallbackText: string): unknown {
  const record = asRecord(item);
  return record?.output ?? record?.result ?? record?.response ?? fallbackText;
}

export function extractNativeToolCallId(item: unknown): string | null {
  const record = asRecord(item);
  const direct = [record?.id, record?.tool_use_id, record?.toolUseId, record?.call_id, record?.callId];
  for (const candidate of direct) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}
