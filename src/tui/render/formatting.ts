import { RESET, OK, T, DIM } from "./theme-shorthands.js";

/** Format token count: 0, 142, 3.2k, 1.5M */
export function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Format cost: $0.00, $0.0012, $1.23 */
export function fmtCost(c: number): string {
  if (c === 0) return "$0.00";
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

/** Intra-line diff: highlight changed span between two lines */
export function intraLineDiff(oldLine: string, newLine: string, maxW: number): { oldHighlighted: string; newHighlighted: string } {
  const INVERSE = "\x1b[7m";
  const NO_INVERSE = "\x1b[27m";

  let prefixLen = 0;
  const minLen = Math.min(oldLine.length, newLine.length);
  while (prefixLen < minLen && oldLine[prefixLen] === newLine[prefixLen]) prefixLen++;

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLine[oldLine.length - 1 - suffixLen] === newLine[newLine.length - 1 - suffixLen]
  ) suffixLen++;

  const oldPrefix = oldLine.slice(0, prefixLen);
  const oldChanged = oldLine.slice(prefixLen, oldLine.length - suffixLen);
  const oldSuffix = oldLine.slice(oldLine.length - suffixLen);

  const newPrefix = newLine.slice(0, prefixLen);
  const newChanged = newLine.slice(prefixLen, newLine.length - suffixLen);
  const newSuffix = newLine.slice(newLine.length - suffixLen);

  const oldHighlighted = oldChanged
    ? `${oldPrefix}${INVERSE}${oldChanged}${NO_INVERSE}${oldSuffix}`.slice(0, maxW)
    : oldLine.slice(0, maxW);
  const newHighlighted = newChanged
    ? `${newPrefix}${INVERSE}${newChanged}${NO_INVERSE}${newSuffix}`.slice(0, maxW)
    : newLine.slice(0, maxW);

  return { oldHighlighted, newHighlighted };
}

/** Word-aware text wrapping — never breaks mid-word if possible */
export function wordWrap(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length <= width) {
      current += word;
    } else if (current.length === 0) {
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
    } else {
      lines.push(current);
      current = word.trimStart();
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Bouncing dot animation: green dot slides across dim dots */
export function bounceDot(frame: number, len = 4): string {
  const cycle = (len - 1) * 2;
  const pos = frame % cycle;
  const idx = pos < len ? pos : cycle - pos;
  let s = "";
  for (let i = 0; i < len; i++) {
    s += i === idx ? `${OK()}\u2022${RESET}` : `${DIM}\u00B7${RESET}`;
  }
  return s;
}
