import { buildTaskExecutionAddendum } from "../core/context.js";

const TURN_FRAME_START = "<turn-frame>";
const TURN_FRAME_END = "</turn-frame>";

export function buildTurnFrame(userMessage: string, scaffold: string): string {
  const addendum = buildTaskExecutionAddendum(userMessage);
  return [
    TURN_FRAME_START,
    "Follow this turn guidance before answering:",
    scaffold.trim(),
    addendum,
    TURN_FRAME_END,
  ].filter(Boolean).join("\n\n");
}

export function applyTurnFrame(
  messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>,
  userMessage: string,
  scaffold: string,
): Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }> {
  const frame = buildTurnFrame(userMessage, scaffold);
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
