import type { ToolExecutionActivity, TurnActivitySnapshot } from "./app-types.js";
import type { TurnEvent } from "../core/turn-events.js";
import { cloneToolExecution, deriveActivityStep } from "./live-activity.js";

export interface TurnActivityState {
  events: TurnEvent[];
  summary: string;
  tools: ToolExecutionActivity[];
}

function findToolIndex(state: TurnActivityState, invocationId: string): number {
  return state.tools.findIndex((tool) => tool.id === invocationId);
}

export function createTurnActivityState(): TurnActivityState {
  return {
    events: [],
    summary: "",
    tools: [],
  };
}

export function clearTurnActivityState(state: TurnActivityState): void {
  state.events = [];
  state.summary = "";
  state.tools = [];
}

export function recordTurnEvent(
  state: TurnActivityState,
  event: TurnEvent,
  options?: { expanded?: boolean },
): void {
  state.events.push(event);
  switch (event.type) {
    case "activity.summary":
      state.summary = event.summary.trim();
      return;
    case "tool.started": {
      const index = findToolIndex(state, event.invocationId);
      const nextTool: ToolExecutionActivity = {
        id: event.invocationId,
        callId: event.callId,
        name: event.toolName,
        preview: event.preview,
        args: event.args,
        expanded: options?.expanded ?? false,
        startedAt: event.timestamp,
        status: "starting",
      };
      if (index >= 0) state.tools[index] = { ...state.tools[index], ...nextTool };
      else state.tools.push(nextTool);
      return;
    }
    case "tool.updated": {
      const index = findToolIndex(state, event.invocationId);
      if (index >= 0) {
        state.tools[index] = {
          ...state.tools[index],
          callId: event.callId,
          name: event.toolName,
          preview: event.preview,
          args: event.args,
          status: "running",
        };
      }
      return;
    }
    case "tool.finished": {
      const index = findToolIndex(state, event.invocationId);
      if (index >= 0) {
        state.tools[index] = {
          ...state.tools[index],
          callId: event.callId,
          name: event.toolName,
          result: event.result,
          error: event.error,
          resultDetail: event.resultDetail,
          completedAt: event.timestamp,
          status: event.error ? "failed" : "done",
        };
      }
      return;
    }
    case "tool.output": {
      const index = findToolIndex(state, event.invocationId);
      if (index >= 0) {
        state.tools[index] = {
          ...state.tools[index],
          streamOutput: `${state.tools[index]?.streamOutput ?? ""}${event.chunk}`,
          status: "running",
        };
      }
      return;
    }
    default:
      return;
  }
}

export function buildTurnActivitySnapshot(
  state: TurnActivityState,
  options: { isCompacting: boolean; startedAt?: number; compactStartTime?: number },
): TurnActivitySnapshot | null {
  const step = deriveActivityStep({
    summary: state.summary,
    tools: state.tools,
    isCompacting: options.isCompacting,
    startedAt: options.startedAt,
    compactStartTime: options.compactStartTime,
  });

  if (!step && state.tools.length === 0) return null;
  return {
    step,
    tools: state.tools.map(cloneToolExecution),
  };
}
