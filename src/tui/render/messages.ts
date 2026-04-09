import stripAnsi from "strip-ansi";
import { renderMarkdown } from "../../utils/markdown.js";
import { getSettings } from "../../core/config.js";
import { currentTheme } from "../../core/themes.js";

export interface RenderChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  thinkingDuration?: number;
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

function renderUserImageRows(images: Array<{ mimeType: string; data: string }>, maxWidth: number, tag: string): string[] {
  const rows: string[] = [];
  let current = "";
  for (let i = 0; i < images.length; i++) {
    const token = tag.replace("#1", `#${i + 1}`);
    const candidate = current ? `${current} ${token}` : token;
    if (current && stripAnsi(candidate).length > maxWidth) {
      rows.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current) rows.push(current);
  return rows;
}

function renderAssistantThinking(options: {
  thinking: string;
  duration?: number;
  maxWidth: number;
  wordWrap: (text: string, width: number) => string[];
  colors: { muted: string };
  reset: string;
}): string[] {
  const { thinking, duration, maxWidth, wordWrap, colors, reset } = options;
  const lines: string[] = [];
  const label = duration && duration > 0 ? `Thinking · ${duration}s` : "Thinking";
  lines.push(`${colors.muted}  ${label}${reset}`);
  for (const rawLine of thinking.split("\n")) {
    for (const wrappedLine of wordWrap(rawLine, Math.max(8, maxWidth - 4))) {
      lines.push(`${colors.muted}  ${wrappedLine}${reset}`);
    }
  }
  return lines;
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
      const accent = "▌";
      const availW = Math.max(1, maxWidth - 3);
      for (const contentLine of msg.content.split("\n")) {
        for (const text of wordWrap(contentLine, availW)) {
          lines.push(`${colors.userAccent}${accent}${reset} ${colors.userText}${text}${reset}`);
        }
      }
      if (getSettings().terminal.showImages && msg.images && msg.images.length > 0) {
        const imageTag = `${colors.imageTagBg}${bold}${colors.text}[Image #1]${reset}`;
        for (const row of renderUserImageRows(msg.images, availW, imageTag)) {
          lines.push(`${colors.userAccent}${accent}${reset} ${row}`);
        }
      }
      lines.push("");
    } else if (msg.role === "assistant") {
      const hideThinking = getSettings().hideThinkingBlock;
      if (msg.thinking && !hideThinking) {
        lines.push(...renderAssistantThinking({
          thinking: msg.thinking,
          duration: msg.thinkingDuration,
          maxWidth,
          wordWrap,
          colors: { muted: colors.muted },
          reset,
        }));
        if (msg.content.trim()) lines.push("");
      }
      if (!msg.content.trim()) {
        idx++;
        continue;
      }
      const rendered = currentTheme().dark ? renderMarkdown(msg.content) : stripAnsi(renderMarkdown(msg.content));
      const wrapW = maxWidth - 4;
      let firstAssistantLine = true;
      for (const cl of rendered.split("\n")) {
        const plain = stripAnsi(cl);
        const themedPrefix = `${colors.text}`;
        const themedLine = cl.includes(reset) ? cl.replaceAll(reset, `${reset}${colors.text}`) : cl;
        if (plain.length <= wrapW) {
          const lead = firstAssistantLine ? "• " : "  ";
          lines.push(`${lead}${themedPrefix}${themedLine}${reset}`);
          firstAssistantLine = false;
          continue;
        }
        const prefix = extractAnsiPrefix(cl);
        for (const wrappedLine of wordWrap(plain, wrapW)) {
          const lead = firstAssistantLine ? "• " : "  ";
          lines.push(`${lead}${themedPrefix}${prefix}${wrappedLine}${reset}`);
          firstAssistantLine = false;
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
