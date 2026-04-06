/**
 * Popout — renders a floating bordered panel centered on screen.
 * Used for model picker, settings, file picker, etc.
 *
 * Visual style inspired by OpenCode:
 * ╭─ Title ─────────────────────╮
 * │  > Item one                 │
 * │    Item two                 │
 * │    Item three               │
 * ╰─────────────── (1/3) ──────╯
 */

import stripAnsi from "strip-ansi";
import { BOX, DIM, RESET, BOLD, WHITE } from "../utils/ansi.js";

export interface PopoutOptions {
  title: string;
  lines: string[];          // Pre-formatted content lines (with ANSI)
  footer?: string;          // Footer text (right-aligned in bottom border)
  width: number;            // Desired inner width
  screenWidth: number;
  screenHeight: number;
  themeColor: string;       // Primary color escape code
}

/** Render a popout as an array of full-width screen lines with dimmed background */
export function renderPopout(opts: PopoutOptions): string[] {
  const { title, lines, footer, screenWidth, screenHeight, themeColor } = opts;
  const innerW = Math.min(opts.width, screenWidth - 4);
  const outerW = innerW + 2; // +2 for left/right border chars
  const leftPad = Math.max(0, Math.floor((screenWidth - outerW) / 2));
  const pad = " ".repeat(leftPad);
  const borderColor = `${DIM}`;

  const result: string[] = [];

  // Top border with title
  const titleText = ` ${title} `;
  const titlePlain = stripAnsi(titleText);
  const topFill = Math.max(0, innerW - titlePlain.length - 1);
  result.push(
    `${pad}${borderColor}${BOX.tl}${BOX.h}${RESET}${themeColor}${BOLD}${titleText}${RESET}${borderColor}${BOX.h.repeat(topFill)}${BOX.tr}${RESET}`
  );

  // Content lines
  const maxLines = Math.min(lines.length, screenHeight - 6);
  for (let i = 0; i < maxLines; i++) {
    const line = lines[i];
    const visLen = stripAnsi(line).length;
    const fill = Math.max(0, innerW - visLen);
    result.push(
      `${pad}${borderColor}${BOX.v}${RESET}${line}${" ".repeat(fill)}${borderColor}${BOX.v}${RESET}`
    );
  }

  // Bottom border with optional footer
  if (footer) {
    const footerPlain = stripAnsi(footer);
    const botFill = Math.max(0, innerW - footerPlain.length - 1);
    result.push(
      `${pad}${borderColor}${BOX.bl}${BOX.h.repeat(botFill)}${RESET}${DIM}${footer}${RESET}${borderColor}${BOX.h}${BOX.br}${RESET}`
    );
  } else {
    result.push(
      `${pad}${borderColor}${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}${RESET}`
    );
  }

  return result;
}

/** Dim a line of text (for background behind popout) */
export function dimLine(line: string): string {
  return `${DIM}${stripAnsi(line)}${RESET}`;
}

/**
 * Overlay a popout onto a frame of lines.
 * Centers the popout vertically and dims background lines behind it.
 */
export function overlayPopout(
  frame: string[],
  popout: string[],
  screenHeight: number,
): string[] {
  const result = [...frame];
  // Ensure we have enough lines
  while (result.length < screenHeight) result.push("");

  // Center vertically
  const startRow = Math.max(1, Math.floor((screenHeight - popout.length) / 2));

  // Dim all lines in the popout zone (± 1 for visual clarity)
  const dimStart = Math.max(0, startRow - 1);
  const dimEnd = Math.min(screenHeight, startRow + popout.length + 1);
  for (let i = dimStart; i < dimEnd; i++) {
    if (i >= 0 && i < result.length) {
      result[i] = dimLine(result[i]);
    }
  }

  // Overlay popout lines
  for (let i = 0; i < popout.length; i++) {
    const row = startRow + i;
    if (row >= 0 && row < result.length) {
      result[row] = popout[i];
    }
  }

  return result;
}
