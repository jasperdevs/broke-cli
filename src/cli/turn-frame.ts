import { buildTaskExecutionAddendum } from "../core/context.js";
import type { ToolName } from "../tools/registry.js";

const TURN_FRAME_START = "<turn-frame>";
const TURN_FRAME_END = "</turn-frame>";
const TOOL_GUIDANCE: Partial<Record<ToolName, string>> = {
  bash: "bash: only for real commands/tests/builds. Avoid shell reads/searches when native tools can do it cheaper.",
  semSearch: "semSearch: use for conceptual discovery before broader exact search.",
  readFile: "readFile: prefer targeted reads with offset/limit on large files.",
  editFile: "editFile: default patch path for existing files. old_string must be exact and unique.",
  writeFile: "writeFile: only for new files or deliberate full rewrites.",
  listFiles: "listFiles: use for cheap tree discovery; keep depth narrow.",
  grep: "grep: use for exact strings/usages; narrow with include when possible.",
  webSearch: "webSearch: only for current external facts.",
  webFetch: "webFetch: fetch a specific URL once you know the target.",
  todoWrite: "todoWrite: use only for genuinely multi-step work.",
};

function buildToolGuidance(allowedTools: readonly ToolName[] = []): string {
  const lines = allowedTools
    .map((tool) => TOOL_GUIDANCE[tool])
    .filter((line): line is string => !!line);
  if (lines.length === 0) return "";
  return ["Use only the exposed tools for this turn:", ...lines].join("\n");
}

export function buildTurnFrame(userMessage: string, scaffold: string, allowedTools: readonly ToolName[] = []): string {
  const addendum = buildTaskExecutionAddendum(userMessage);
  const toolGuidance = buildToolGuidance(allowedTools);
  return [
    TURN_FRAME_START,
    "Follow this turn guidance before answering:",
    scaffold.trim(),
    toolGuidance,
    addendum,
    TURN_FRAME_END,
  ].filter(Boolean).join("\n\n");
}

export function applyTurnFrame(
  messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>,
  userMessage: string,
  scaffold: string,
  allowedTools: readonly ToolName[] = [],
): Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }> {
  const frame = buildTurnFrame(userMessage, scaffold, allowedTools);
  const lastUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index;

  if (lastUserIndex == null) {
    return [...messages, { role: "user", content: frame }];
  }

  return messages.map((message, index) => {
    if (index !== lastUserIndex || message.content.includes(TURN_FRAME_START)) return message;
    return {
      ...message,
      content: `${message.content}\n\n${frame}`,
    };
  });
}
