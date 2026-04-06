import stripAnsi from "strip-ansi";

function readEscapeSequence(text: string, start: number): number {
  if (text[start] !== "\x1b") return start;
  const next = text[start + 1];
  if (next === "[") {
    let i = start + 2;
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) return i;
      i++;
    }
    return text.length - 1;
  }
  if (next === "]") {
    let i = start + 2;
    while (i < text.length) {
      if (text[i] === "\x07") return i;
      if (text[i] === "\x1b" && text[i + 1] === "\\") return i + 1;
      i++;
    }
    return text.length - 1;
  }
  return Math.min(text.length - 1, start + 1);
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3040 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x1fa70 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )) return true;
  return false;
}

export function charWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (isCombiningCodePoint(codePoint)) return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}

export function visibleWidth(text: string): number {
  let width = 0;
  const plain = stripAnsi(text);
  for (const char of plain) width += charWidth(char);
  return width;
}

export function truncateVisible(text: string, targetWidth: number): string {
  if (targetWidth <= 0) return "";
  let out = "";
  let used = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1b") {
      const end = readEscapeSequence(text, i);
      out += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const codePoint = text.codePointAt(i)!;
    const char = String.fromCodePoint(codePoint);
    const width = charWidth(char);
    if (used + width > targetWidth) break;
    out += char;
    used += width;
    i += char.length;
  }
  return out;
}

export function padVisible(text: string, targetWidth: number): string {
  const width = visibleWidth(text);
  if (width >= targetWidth) return width === targetWidth ? text : truncateVisible(text, targetWidth);
  return text + " ".repeat(targetWidth - width);
}

