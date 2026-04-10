export type TurnEvent =
  | { type: "thinking.delta"; delta: string; timestamp: number }
  | { type: "assistant.delta"; delta: string; timestamp: number }
  | { type: "tool.started"; invocationId: string; toolName: string; callId?: string; preview: string; args?: unknown; timestamp: number }
  | { type: "tool.updated"; invocationId: string; toolName: string; callId?: string; preview: string; args?: unknown; timestamp: number }
  | { type: "tool.output"; invocationId: string; chunk: string; timestamp: number }
  | { type: "tool.finished"; invocationId: string; toolName: string; callId?: string; result: string; error?: boolean; resultDetail?: string; timestamp: number }
  | { type: "activity.summary"; summary: string; timestamp: number };

export function createTurnTimestamp(now = Date.now()): number {
  return now;
}
