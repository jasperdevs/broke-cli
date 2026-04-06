/** ANSI escape code constants and helpers */

export const ESC = "\x1b";
export const CSI = `${ESC}[`;

// Screen
export const ALT_SCREEN_ON = `${CSI}?1049h`;
export const ALT_SCREEN_OFF = `${CSI}?1049l`;
export const CLEAR_SCREEN = `${CSI}2J`;
export const CLEAR_LINE = `${CSI}2K`;
export const CURSOR_HOME = `${CSI}H`;

// Cursor
export const CURSOR_HIDE = `${CSI}?25l`;
export const CURSOR_SHOW = `${CSI}?25h`;
export const CURSOR_SAVE = `${ESC}7`;
export const CURSOR_RESTORE = `${ESC}8`;

// Synchronized output (CSI 2026 — prevents flicker)
export const SYNC_START = `${CSI}?2026h`;
export const SYNC_END = `${CSI}?2026l`;

// Bracketed paste mode
export const PASTE_MODE_ON = `${CSI}?2004h`;
export const PASTE_MODE_OFF = `${CSI}?2004l`;

// Mouse tracking (SGR extended mode — scroll wheel support)
export const MOUSE_ON = `${CSI}?1000h${CSI}?1006h`;
export const MOUSE_OFF = `${CSI}?1000l${CSI}?1006l`;

// Move cursor to row,col (1-based)
export function moveTo(row: number, col: number): string {
  return `${CSI}${row};${col}H`;
}

// Move cursor to start of row
export function moveToRow(row: number): string {
  return `${CSI}${row};1H`;
}

// Colors (24-bit)
export function fg(r: number, g: number, b: number): string {
  return `${CSI}38;2;${r};${g};${b}m`;
}

export function bg(r: number, g: number, b: number): string {
  return `${CSI}48;2;${r};${g};${b}m`;
}

export const RESET = `${CSI}0m`;
export const BOLD = `${CSI}1m`;
export const DIM = `${CSI}2m`;

// Brand colors
export const GREEN = fg(58, 199, 58);       // #3AC73A
export const GREEN_DIM = fg(42, 154, 42);   // #2a9a2a
export const WHITE = fg(255, 255, 255);
export const GRAY = fg(128, 128, 128);
export const RED = fg(255, 80, 80);
export const YELLOW = fg(255, 200, 50);

/** Write directly to stdout without newline */
export function write(s: string): void {
  process.stdout.write(s);
}

/** Get terminal dimensions */
export function getTermSize(): { rows: number; cols: number } {
  return {
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  };
}
