import type { ActivityStep, ToolExecutionActivity } from "./app-types.js";

type AppState = any;

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

export function buildActivityLabel(name: string, preview: string): string | null {
  const normalized = normalizeToolName(name);
  const target = preview.trim();
  if (!target || target === "...") {
    switch (normalized) {
      case "readFile": return "reading a file";
      case "writeFile": return "writing a file";
      case "editFile": return "editing a file";
      case "workspaceEdit": return "observing file changes";
      case "listFiles": return "listing files";
      case "glob": return "finding files";
      case "grep": return "searching the repo";
      case "semSearch": return "running semantic search";
      case "webSearch": return "searching the web";
      case "webFetch": return "fetching a webpage";
      case "bash": return "running a command";
      default: return null;
    }
  }
  switch (normalized) {
    case "readFile": return `reading ${target}`;
    case "writeFile": return `writing ${target}`;
    case "editFile": return `editing ${target}`;
    case "workspaceEdit": return `changed ${target}`;
    case "listFiles": return `listing ${target}`;
    case "glob": return `finding ${target}`;
    case "grep": return `searching ${target}`;
    case "semSearch": return `semantic search: ${target}`;
    case "webSearch": return `web search: ${target}`;
    case "webFetch": return `fetching ${target}`;
    case "bash": return `running ${target}`;
    default: return null;
  }
}

export function cloneActivityStep(step: ActivityStep | null): ActivityStep | null {
  return step ? { ...step } : null;
}

export function cloneToolExecution(tool: ToolExecutionActivity): ToolExecutionActivity {
  return { ...tool };
}

export function deriveLiveActivityStep(app: AppState): ActivityStep | null {
  const label = app.streamingActivitySummary?.trim();
  const tools = app.toolExecutions as ToolExecutionActivity[];
  if (tools.length > 0) {
    const startedAt = tools[0]?.startedAt ?? app.streamStartTime ?? Date.now();
    const done = tools.every((tool) => tool.status === "done" || tool.status === "failed");
    return {
      label: label || buildActivityLabel(tools[tools.length - 1]!.name, tools[tools.length - 1]!.preview) || "working",
      status: done ? "done" : "running",
      startedAt,
      completedAt: done ? Date.now() : undefined,
    };
  }
  if (!label) return null;
  if (!app.isCompacting) return null;
  const running = true;
  return {
    label,
    status: running ? "running" : "done",
    startedAt: app.streamStartTime || app.compactStartTime || Date.now(),
    completedAt: running ? undefined : Date.now(),
  };
}
