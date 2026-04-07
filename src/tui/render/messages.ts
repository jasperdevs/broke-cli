import stripAnsi from "strip-ansi";
import { renderMarkdown } from "../../utils/markdown.js";
import { getSettings } from "../../core/config.js";

export interface RenderChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  images?: Array<{ mimeType: string; data: string }>;
}

function wrapVisibleText(text: string, width: number, wordWrap: (text: string, width: number) => string[]): string[] {
  const wrapped: string[] = [];
  for (const line of text.split("\n")) {
    wrapped.push(...wordWrap(line, width));
  }
  return wrapped.length > 0 ? wrapped : [""];
}

function extractAnsiPrefix(line: string): string {
  const match = line.match(/^((?:\x1b\[[0-9;?]*[ -/]*[@-~])*)/);
  return match?.[1] ?? "";
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
    userAccent: string;
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
      if (getSettings().terminal.showImages && msg.images && msg.images.length > 0) {
        for (let i = 0; i < msg.images.length; i++) {
          const tag = `${colors.imageTagBg}${bold}${colors.text}[Image #${i + 1}]${reset}`;
          content += ` ${tag}`;
        }
      }
      const accent = "▌";
      const availW = Math.max(1, maxWidth - 3);
      for (const contentLine of content.split("\n")) {
        for (const text of wordWrap(contentLine, availW)) {
          lines.push(`${colors.userAccent}${accent}${reset} ${colors.userText}${text}${reset}`);
        }
      }
      lines.push("");
    } else if (msg.role === "assistant") {
      const rendered = renderMarkdown(msg.content);
      const wrapW = maxWidth - 4;
      for (const cl of rendered.split("\n")) {
        const plain = stripAnsi(cl);
        const themedPrefix = `${colors.text}`;
        const themedLine = cl.includes(reset) ? cl.replaceAll(reset, `${reset}${colors.text}`) : cl;
        if (plain.length <= wrapW) {
          lines.push(`  ${themedPrefix}${themedLine}${reset}`);
          continue;
        }
        const prefix = extractAnsiPrefix(cl);
        for (const wrappedLine of wordWrap(plain, wrapW)) {
          lines.push(`  ${themedPrefix}${prefix}${wrappedLine}${reset}`);
        }
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
        const plain = stripAnsi(cl);
        if (plain.length <= wrapW) {
          lines.push(`  ${cl}`);
          continue;
        }
        const colorPrefix = extractAnsiPrefix(cl);
        for (const wrappedLine of wordWrap(plain, wrapW)) {
          lines.push(`  ${colorPrefix}${wrappedLine}${reset}`);
        }
      }
    } else {
      const wrapW = maxWidth - 4;
      for (const wrappedLine of wrapVisibleText(msg.content, wrapW, wordWrap)) {
        lines.push(`${colors.muted}  ${wrappedLine}${reset}`);
      }
    }
    lines.push("");
    idx++;
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
