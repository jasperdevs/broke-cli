import { observeToolResult } from "./turn-tool-observer.js";

type ToolCallbackApp = {
  addToolCall(name: string, preview: string): void;
  updateToolCallArgs(name: string, preview: string, args?: unknown): void;
  addToolResult(name: string, result: string, error?: boolean, detail?: string): void;
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
    onToolCallStart: (name: string) => {
      onToolActivity();
      if (name !== "todoWrite") app.addToolCall(name, "...");
    },
    onToolCall: (name: string, args: unknown) => {
      onToolActivity();
      hooks.emit("on_tool_call", { name, args });
      nextToolCalls.push(name);
      lastToolArgsByName.set(name, args);
      if (name === "todoWrite") return;
      app.updateToolCallArgs(name, buildToolPreview(name, args), args);
    },
    onToolResult: (_name: string, result: unknown) => {
      hooks.emit("on_tool_result", { name: _name, result });
      if (_name === "todoWrite") return;
      const r = result as { success?: boolean; output?: string; error?: string; content?: string; matches?: unknown[]; files?: string[] };
      const toolArgs = lastToolArgsByName.get(_name) as Record<string, unknown> | undefined;
      const detail = observeToolResult({ session: session as any, toolName: _name, result: r, toolArgs });
      if (r && typeof r === "object" && r.success === false && typeof r.error === "string") {
        app.addToolResult(_name, r.error.slice(0, 80), true);
      } else {
        app.addToolResult(_name, "ok", false, detail);
      }
    },
    onAfterToolCall: () => {
      if (!app.hasPendingMessages("steering")) return;
      onSteeringInterrupt();
    },
  };
}
