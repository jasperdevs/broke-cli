/**
 * Markdown renderer — uses marked.lexer() for parsing (token AST only)
 * and walks the token tree to produce ANSI-styled terminal output.
 * Inspired by Pi's approach: no HTML renderer, just lexer + custom walker.
 *
 * Syntax highlighting via cli-highlight (highlight.js based).
 */

import { marked } from "marked";

let highlightFn: ((code: string, opts: { language: string; ignoreIllegals: boolean }) => string) | null = null;
let supportsLangFn: ((lang: string) => boolean) | null = null;

// ANSI codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";
const STRIKETHROUGH = "\x1b[9m";
const GREEN = "\x1b[38;2;58;199;58m";
const WHITE = "\x1b[38;2;255;255;255m";
const GRAY = "\x1b[38;2;128;128;128m";
const YELLOW = "\x1b[38;2;255;200;50m";
const CYAN = "\x1b[38;2;100;200;200m";
const CODE_BG = "\x1b[48;2;30;30;30m";

let initialized = false;

interface Token {
  type: string;
  raw?: string;
  text?: string;
  tokens?: Token[];
  items?: Token[];
  ordered?: boolean;
  start?: number;
  depth?: number;
  lang?: string;
  header?: Token[][];
  rows?: Token[][][];
  align?: (string | null)[];
  href?: string;
  title?: string;
  codeBlockStyle?: string;
  task?: boolean;
  checked?: boolean;
  loose?: boolean;
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cliHighlight = require("cli-highlight");
    highlightFn = (code: string, opts: { language: string; ignoreIllegals: boolean }) => {
      try { return cliHighlight.highlight(code, opts); }
      catch { return code; }
    };
    supportsLangFn = (lang: string) => {
      try { return cliHighlight.supportsLanguage(lang); }
      catch { return false; }
    };
  } catch {
    // cli-highlight unavailable
  }
}

/** Render inline tokens to ANSI string */
function renderInline(tokens: Token[], parentStyle = ""): string {
  let out = "";
  for (const t of tokens) {
    switch (t.type) {
      case "text":
        out += t.text ?? "";
        break;
      case "strong":
        out += `${BOLD}${WHITE}${renderInline(t.tokens ?? [], BOLD + WHITE)}${RESET}${parentStyle}`;
        break;
      case "em":
        out += `${ITALIC}${renderInline(t.tokens ?? [], ITALIC)}${RESET}${parentStyle}`;
        break;
      case "del":
        out += `${STRIKETHROUGH}${DIM}${renderInline(t.tokens ?? [], STRIKETHROUGH + DIM)}${RESET}${parentStyle}`;
        break;
      case "codespan":
        out += `${CODE_BG}${GREEN} ${t.text ?? ""} ${RESET}${parentStyle}`;
        break;
      case "link": {
        const linkText = renderInline(t.tokens ?? [], UNDERLINE + CYAN);
        const href = t.href ?? "";
        if (linkText.replace(/\x1b\[[^m]*m/g, "") === href) {
          out += `${UNDERLINE}${CYAN}${href}${RESET}${parentStyle}`;
        } else {
          out += `${UNDERLINE}${CYAN}${linkText}${RESET}${parentStyle} ${DIM}(${href})${RESET}${parentStyle}`;
        }
        break;
      }
      case "image":
        out += `${DIM}[image: ${t.text ?? t.href ?? ""}]${RESET}${parentStyle}`;
        break;
      case "br":
        out += "\n";
        break;
      case "escape":
        out += t.text ?? "";
        break;
      case "html":
        // Strip HTML tags, show text content
        out += (t.text ?? "").replace(/<[^>]+>/g, "");
        break;
      default:
        out += t.raw ?? t.text ?? "";
        break;
    }
  }
  return out;
}

/** Render a block-level token to lines */
function renderBlock(token: Token, indent = ""): string[] {
  const lines: string[] = [];

  switch (token.type) {
    case "heading": {
      const text = renderInline(token.tokens ?? []);
      const depth = token.depth ?? 1;
      if (depth === 1) {
        lines.push(`${indent}${BOLD}${UNDERLINE}${GREEN}${text}${RESET}`);
      } else if (depth === 2) {
        lines.push(`${indent}${BOLD}${GREEN}${text}${RESET}`);
      } else {
        const prefix = "#".repeat(depth) + " ";
        lines.push(`${indent}${GREEN}${prefix}${text}${RESET}`);
      }
      lines.push("");
      break;
    }

    case "paragraph": {
      const text = renderInline(token.tokens ?? []);
      // Split long lines for readability
      const paraLines = text.split("\n");
      for (const l of paraLines) {
        lines.push(`${indent}${l}`);
      }
      lines.push("");
      break;
    }

    case "code": {
      const lang = (token.lang ?? "").trim();
      const code = token.text ?? "";
      const border = `${DIM}${"─".repeat(40)}${RESET}`;

      if (lang) {
        lines.push(`${indent}${border} ${DIM}${lang}${RESET}`);
      } else {
        lines.push(`${indent}${border}`);
      }

      let highlighted = code;
      if (lang && highlightFn && supportsLangFn && supportsLangFn(lang)) {
        highlighted = highlightFn(code, { language: lang, ignoreIllegals: true });
      }

      for (const cl of highlighted.split("\n")) {
        lines.push(`${indent}  ${cl}`);
      }
      lines.push(`${indent}${border}`);
      lines.push("");
      break;
    }

    case "blockquote": {
      const inner = token.tokens ?? [];
      for (const child of inner) {
        const childLines = renderBlock(child, "");
        for (const cl of childLines) {
          lines.push(`${indent}${DIM}│${RESET} ${ITALIC}${cl}${RESET}`);
        }
      }
      lines.push("");
      break;
    }

    case "list": {
      const items = token.items ?? [];
      const ordered = token.ordered ?? false;
      const startNum = token.start ?? 1;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const bullet = ordered ? `${DIM}${startNum + i}.${RESET}` : `${GREEN}\u2022${RESET}`;

        // Render item content
        const itemTokens = item.tokens ?? [];
        let firstLine = true;
        for (const child of itemTokens) {
          if (child.type === "text" && child.tokens) {
            // Inline text within list item
            const text = renderInline(child.tokens);
            const textLines = text.split("\n");
            for (const tl of textLines) {
              if (firstLine) {
                const checkbox = item.task ? (item.checked ? `${GREEN}[x]${RESET} ` : `${DIM}[ ]${RESET} `) : "";
                lines.push(`${indent} ${bullet} ${checkbox}${tl}`);
                firstLine = false;
              } else {
                lines.push(`${indent}   ${tl}`);
              }
            }
          } else if (child.type === "list") {
            // Nested list
            const nested = renderBlock(child, indent + "  ");
            for (const nl of nested) lines.push(nl);
          } else {
            const childLines = renderBlock(child, indent + "   ");
            for (const cl of childLines) {
              if (firstLine) {
                const checkbox = item.task ? (item.checked ? `${GREEN}[x]${RESET} ` : `${DIM}[ ]${RESET} `) : "";
                lines.push(`${indent} ${bullet} ${checkbox}${cl.trimStart()}`);
                firstLine = false;
              } else {
                lines.push(cl);
              }
            }
          }
        }
      }
      lines.push("");
      break;
    }

    case "table": {
      const header = token.header ?? [];
      const rows = token.rows ?? [];
      const aligns = token.align ?? [];

      // Calculate column widths
      const colCount = header.length;
      const colWidths: number[] = new Array(colCount).fill(0);
      for (let c = 0; c < colCount; c++) {
        const hText = renderInline(header[c] ?? []);
        colWidths[c] = Math.max(colWidths[c], stripAnsi(hText).length);
      }
      for (const row of rows) {
        for (let c = 0; c < colCount; c++) {
          const cellText = renderInline(row[c] ?? []);
          colWidths[c] = Math.max(colWidths[c], stripAnsi(cellText).length);
        }
      }

      // Cap column widths
      for (let c = 0; c < colCount; c++) {
        colWidths[c] = Math.min(colWidths[c], 40);
      }

      // Header
      const hCells = header.map((h, i) => padCell(renderInline(h), colWidths[i], aligns[i]));
      lines.push(`${indent}${DIM}${BOLD}${hCells.join(` ${DIM}|${RESET} ${DIM}${BOLD}`)}${RESET}`);
      // Separator
      const sepCells = colWidths.map(w => "─".repeat(w));
      lines.push(`${indent}${DIM}${sepCells.join("─┼─")}${RESET}`);
      // Rows
      for (const row of rows) {
        const rCells = row.map((cell, i) => padCell(renderInline(cell), colWidths[i], aligns[i]));
        lines.push(`${indent}${rCells.join(` ${DIM}|${RESET} `)}`);
      }
      lines.push("");
      break;
    }

    case "hr":
      lines.push(`${indent}${DIM}${"─".repeat(40)}${RESET}`);
      lines.push("");
      break;

    case "space":
      lines.push("");
      break;

    case "html":
      // Render HTML blocks as dimmed raw text
      if (token.text) {
        for (const l of token.text.split("\n")) {
          lines.push(`${indent}${DIM}${l}${RESET}`);
        }
      }
      break;

    default:
      // Fallback — render raw text
      if (token.tokens) {
        lines.push(`${indent}${renderInline(token.tokens)}`);
      } else if (token.text) {
        lines.push(`${indent}${token.text}`);
      } else if (token.raw) {
        lines.push(`${indent}${token.raw}`);
      }
      break;
  }

  return lines;
}

/** Strip ANSI escape codes */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[^m]*m/g, "");
}

/** Pad a cell to a given width, respecting alignment */
function padCell(text: string, width: number, align: string | null): string {
  const plain = stripAnsi(text);
  const pad = Math.max(0, width - plain.length);
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + text + " ".repeat(pad - left);
  }
  return text + " ".repeat(pad);
}

/** Render markdown to terminal-formatted string */
export function renderMarkdown(text: string): string {
  ensureInit();

  try {
    const tokens = marked.lexer(text) as Token[];
    const lines: string[] = [];

    for (const token of tokens) {
      const blockLines = renderBlock(token);
      for (const l of blockLines) lines.push(l);
    }

    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    return lines.join("\n");
  } catch {
    return text;
  }
}
