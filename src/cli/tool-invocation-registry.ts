type ToolInvocationRecord = {
  invocationId: string;
  toolName: string;
  callId?: string;
  args?: unknown;
  active: boolean;
};

function normalizeToolName(name: string): string {
  switch (name) {
    case "Read": return "readFile";
    case "Write": return "writeFile";
    case "Edit": return "editFile";
    case "LS": return "listFiles";
    case "Glob": return "glob";
    default: return name;
  }
}

export function createToolInvocationRegistry() {
  let syntheticCounter = 0;
  const byInvocationId = new Map<string, ToolInvocationRecord>();
  const byCallId = new Map<string, string>();
  const activeByToolName = new Map<string, string[]>();

  const rememberActive = (toolName: string, invocationId: string): void => {
    const queue = activeByToolName.get(toolName) ?? [];
    if (!queue.includes(invocationId)) queue.push(invocationId);
    activeByToolName.set(toolName, queue);
  };

  const forgetActive = (toolName: string, invocationId: string): void => {
    const queue = (activeByToolName.get(toolName) ?? []).filter((id) => id !== invocationId);
    if (queue.length > 0) activeByToolName.set(toolName, queue);
    else activeByToolName.delete(toolName);
  };

  const createRecord = (toolName: string, callId?: string): ToolInvocationRecord => {
    const normalized = normalizeToolName(toolName);
    const invocationId = callId?.trim() || `tool-${normalized}-${++syntheticCounter}`;
    const record: ToolInvocationRecord = {
      invocationId,
      toolName: normalized,
      callId: callId?.trim() || undefined,
      active: true,
    };
    byInvocationId.set(invocationId, record);
    if (record.callId) byCallId.set(record.callId, invocationId);
    rememberActive(normalized, invocationId);
    return record;
  };

  const resolveRecord = (toolName: string, callId?: string): ToolInvocationRecord => {
    const normalized = normalizeToolName(toolName);
    const explicitId = callId?.trim();
    if (explicitId) {
      const existingId = byCallId.get(explicitId);
      if (existingId) {
        const existing = byInvocationId.get(existingId);
        if (existing) return existing;
      }
      return createRecord(normalized, explicitId);
    }
    return createRecord(normalized);
  };

  const resolveActiveRecord = (toolName: string, callId?: string): ToolInvocationRecord => {
    const normalized = normalizeToolName(toolName);
    const explicitId = callId?.trim();
    if (explicitId) {
      const existingId = byCallId.get(explicitId);
      if (existingId) {
        const existing = byInvocationId.get(existingId);
        if (existing) return existing;
      }
      return createRecord(normalized, explicitId);
    }
    const activeId = (activeByToolName.get(normalized) ?? []).at(-1);
    if (activeId) {
      const existing = byInvocationId.get(activeId);
      if (existing) return existing;
    }
    return createRecord(normalized);
  };

  return {
    start(toolName: string, callId?: string) {
      return resolveRecord(toolName, callId);
    },
    update(toolName: string, args: unknown, callId?: string) {
      const record = resolveActiveRecord(toolName, callId);
      record.args = args;
      return record;
    },
    finish(toolName: string, callId?: string) {
      const record = resolveActiveRecord(toolName, callId);
      record.active = false;
      forgetActive(record.toolName, record.invocationId);
      return record;
    },
  };
}
