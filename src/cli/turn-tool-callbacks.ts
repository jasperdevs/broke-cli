import { observeToolResult } from "./turn-tool-observer.js";
import { createToolInvocationRegistry } from "./tool-invocation-registry.js";
import type { PendingDelivery } from "../ui-contracts.js";
import type { CliExtensionHooks } from "./extension-hooks.js";
import type { Session } from "../core/session.js";

type ToolCallbackApp = {
  addToolCall(name: string, preview: string, args?: unknown, callId?: string): void;
  updateToolCallArgs(name: string, preview: string, args?: unknown, callId?: string): void;
  addToolResult(name: string, result: string, error?: boolean, detail?: string, callId?: string): void;
  hasPendingMessages(delivery?: PendingDelivery): boolean;
};

export function createLiveToolCallbacks(options: {
  app: ToolCallbackApp;
  hooks: Pick<CliExtensionHooks, "emit">;
  session: Session;
  nextToolCalls: string[];
  lastToolArgsByName: Map<string, unknown>;
  onToolActivity: () => void;
  onSteeringInterrupt: () => void;
  buildToolPreview: (name: string, args: unknown) => string;
}) {
  const { app, hooks, session, nextToolCalls, lastToolArgsByName, onToolActivity, onSteeringInterrupt, buildToolPreview } = options;
  const registry = createToolInvocationRegistry();
  return {
    onToolCallStart: (name: string, callId?: string) => {
      onToolActivity();
      if (name === "todoWrite") return;
      const record = registry.start(name, callId);
      app.addToolCall(record.toolName, "...", undefined, record.invocationId);
    },
    onToolCall: (name: string, args: unknown, callId?: string) => {
      onToolActivity();
      hooks.emit("on_tool_call", { name, args });
      nextToolCalls.push(name);
      const record = registry.update(name, args, callId);
      lastToolArgsByName.set(record.invocationId, args);
      if (name === "todoWrite") return;
      app.updateToolCallArgs(record.toolName, buildToolPreview(name, args), args, record.invocationId);
    },
    onToolResult: (_name: string, result: unknown, callId?: string) => {
      hooks.emit("on_tool_result", { name: _name, result });
      if (_name === "todoWrite") return;
      const r = result as { success?: boolean; output?: string; error?: string; content?: string; matches?: unknown[]; files?: string[] };
      const record = registry.finish(_name, callId);
      const toolArgs = lastToolArgsByName.get(record.invocationId) as Record<string, unknown> | undefined;
      const detail = observeToolResult({ session, toolName: _name, result: r, toolArgs });
      if (r && typeof r === "object" && r.success === false && typeof r.error === "string") {
        app.addToolResult(record.toolName, r.error.slice(0, 80), true, undefined, record.invocationId);
      } else {
        app.addToolResult(record.toolName, "ok", false, detail, record.invocationId);
      }
    },
    onAfterToolCall: () => {
      if (!app.hasPendingMessages("steering")) return;
      onSteeringInterrupt();
    },
  };
}
