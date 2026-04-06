import stripAnsi from "strip-ansi";
import { renderMarkdown } from "../../utils/markdown.js";

export interface RenderChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  images?: Array<{ mimeType: string; data: string }>;
}

export function renderStaticMessages(options: {
  messages: RenderChatMessage[];
  maxWidth: number;
  toolOutputCollapsed: boolean;
  isToolOutput: (content: string) => boolean;
  wordWrap: (text: string, width: number) => string[];
  colors: {
    imageTagBg: string;
    userBg: string;
    userText: string;
    border: string;
    muted: string;
    text: string;
  };
  reset: string;
  bold: string;
}): string[] {
  const { messages, maxWidth, toolOutputCollapsed, isToolOutput, wordWrap, colors, reset, bold } = options;
  const lines: string[] = [];
  let idx = 0;
  while (idx < messages.length) {
    const msg = messages[idx];
    if (msg.role === "user") {
      let content = msg.content;
      if (msg.images && msg.images.length > 0) {
        for (let i = 0; i < msg.images.length; i++) {
          const tag = `${colors.imageTagBg}${bold}${colors.text}[IMAGE ${i + 1}]${reset}`;
          content += ` ${tag}`;
        }
      }
      const availW = Math.max(1, maxWidth - 4);
      lines.push(`${colors.userBg}${" ".repeat(maxWidth)}${reset}`);
      for (const contentLine of content.split("\n")) {
        for (const text of wordWrap(contentLine, availW)) {
          const padW = Math.max(0, maxWidth - text.length - 4);
          lines.push(`${colors.userBg}${colors.userText}  ${text}${" ".repeat(padW)}  ${reset}`);
        }
      }
      lines.push(`${colors.userBg}${" ".repeat(maxWidth)}${reset}`);
      lines.push("");
    } else if (msg.role === "assistant") {
      const rendered = renderMarkdown(msg.content);
      const wrapW = maxWidth - 4;
      for (const cl of rendered.split("\n")) {
        const plain = stripAnsi(cl);
        if (plain.length <= wrapW) lines.push(`  ${cl}`);
        else for (const wl of wordWrap(plain, wrapW)) lines.push(`  ${wl}`);
      }
      if (idx + 1 < messages.length && messages[idx + 1].role === "user") {
        lines.push("");
        lines.push(`${colors.border}  ${"─".repeat(Math.max(1, maxWidth - 4))}${reset}`);
      }
    } else if (toolOutputCollapsed && isToolOutput(msg.content)) {
      while (idx + 1 < messages.length && messages[idx + 1].role === "system" && isToolOutput(messages[idx + 1].content)) idx++;
      lines.push(`${colors.muted}  [tool output hidden]${reset}`);
    } else if (msg.content.includes("\x1b[")) {
      const wrapW = maxWidth - 4;
      for (const cl of msg.content.split("\n")) {
        const visLen = stripAnsi(cl).length;
        if (visLen <= wrapW) lines.push(`  ${cl}`);
        else {
          const plain = stripAnsi(cl);
          const colorPrefix = cl.slice(0, cl.indexOf(plain[0]));
          for (let i = 0; i < plain.length; i += wrapW) lines.push(`  ${i === 0 ? colorPrefix : ""}${plain.slice(i, i + wrapW)}${reset}`);
        }
      }
    } else {
      const wrapW = maxWidth - 4;
      const plain = msg.content;
      if (plain.length <= wrapW) lines.push(`${colors.muted}  ${plain}${reset}`);
      else for (let i = 0; i < plain.length; i += wrapW) lines.push(`${colors.muted}  ${plain.slice(i, i + wrapW)}${reset}`);
    }
    lines.push("");
    idx++;
  }
  return lines;
}
