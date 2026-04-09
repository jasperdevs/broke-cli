import { observeToolResult } from "./turn-tool-observer.js";

type ToolCallbackApp = {
  addToolCall(name: string, preview: string, args?: unknown, callId?: string): void;
  updateToolCallArgs(name: string, preview: string, args?: unknown, callId?: string): void;
  addToolResult(name: string, result: string, error?: boolean, detail?: string, callId?: string): void;
  hasPendingMessages(delivery?: "steering" | "followup"): boolean;
};

export function createLiveToolCallbacks(options: {
  app: ToolCallbackApp;
  hooks: { emit(event: string, payload: Record<string, unknown>): void };
  session: unknown;
  nextToolCalls: string[];
  lastToolArgsByName: Map<string, unknown>;
  onToolActivity: () => void;
  onSteeringInterrupt: () => void;
  buildToolPreview: (name: string, args: unknown) => string;
}) {
  const { app, hooks, session, nextToolCalls, lastToolArgsByName, onToolActivity, onSteeringInterrupt, buildToolPreview } = options;
  return {
    onToolCallStart: (name: string, callId?: string) => {
      onToolActivity();
      if (name === "todoWrite") return;
      if (callId) app.addToolCall(name, "...", undefined, callId);
      else app.addToolCall(name, "...");
    },
    onToolCall: (name: string, args: unknown, callId?: string) => {
      onToolActivity();
      hooks.emit("on_tool_call", { name, args });
      nextToolCalls.push(name);
      lastToolArgsByName.set(name, args);
      if (name === "todoWrite") return;
      if (callId) app.updateToolCallArgs(name, buildToolPreview(name, args), args, callId);
      else app.updateToolCallArgs(name, buildToolPreview(name, args), args);
    },
    onToolResult: (_name: string, result: unknown, callId?: string) => {
      hooks.emit("on_tool_result", { name: _name, result });
      if (_name === "todoWrite") return;
      const r = result as { success?: boolean; output?: string; error?: string; content?: string; matches?: unknown[]; files?: string[] };
      const toolArgs = lastToolArgsByName.get(_name) as Record<string, unknown> | undefined;
      const detail = observeToolResult({ session: session as any, toolName: _name, result: r, toolArgs });
      if (r && typeof r === "object" && r.success === false && typeof r.error === "string") {
        if (callId) app.addToolResult(_name, r.error.slice(0, 80), true, undefined, callId);
        else app.addToolResult(_name, r.error.slice(0, 80), true);
      } else {
        if (callId) app.addToolResult(_name, "ok", false, detail, callId);
        else app.addToolResult(_name, "ok", false, detail);
      }
    },
    onAfterToolCall: () => {
      if (!app.hasPendingMessages("steering")) return;
      onSteeringInterrupt();
    },
  };
}
