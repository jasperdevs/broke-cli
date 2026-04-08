import { buildTaskExecutionAddendum } from "../core/context.js";
import type { ToolName } from "../tools/registry.js";

const TOOL_GUIDANCE: Partial<Record<ToolName, string>> = {
  bash: "bash only for real commands/tests/builds",
  editFile: "editFile for small exact patches",
  writeFile: "writeFile only for new files or full rewrites",
  webFetch: "webFetch only for the target URL",
};

function buildToolGuidance(allowedTools: readonly ToolName[] = []): string {
  const lines = allowedTools
    .map((tool) => TOOL_GUIDANCE[tool])
    .filter((line): line is string => !!line);
  if (lines.length === 0) return "";
  return `tools: ${lines.join("; ")}`;
}

export function buildTurnFrame(userMessage: string, scaffold: string, allowedTools: readonly ToolName[] = []): string {
  const addendum = buildTaskExecutionAddendum(userMessage);
  const toolGuidance = buildToolGuidance(allowedTools);
  const compactAddendum = addendum
    ? addendum
        .replace(/^<task-rules>\n?/, "")
        .replace(/\n?<\/task-rules>$/, "")
        .trim()
    : "";
  return [scaffold.trim(), toolGuidance, compactAddendum].filter(Boolean).join("\n");
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
    if (index !== lastUserIndex || message.content.includes(scaffold.trim())) return message;
    return {
      ...message,
      content: `${message.content}\n\n${frame}`,
    };
  });
}
