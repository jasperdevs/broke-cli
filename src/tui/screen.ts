import {
  ALT_SCREEN_ON, ALT_SCREEN_OFF, CLEAR_SCREEN, CLEAR_LINE,
  CURSOR_HOME, CURSOR_HIDE, CURSOR_SHOW,
  SYNC_START, SYNC_END, moveToRow, write, getTermSize,
} from "../utils/ansi.js";

/**
 * Screen — differential rendering engine.
 * Maintains a buffer of lines. On render(), diffs against previous
 * buffer and only rewrites changed lines. Uses CSI 2026 synchronized
 * output to prevent flicker.
 */
export class Screen {
  private prev: string[] = [];
  private rows: number;
  private cols: number;

  constructor() {
    const size = getTermSize();
    this.rows = size.rows;
    this.cols = size.cols;

    process.stdout.on("resize", () => {
      const s = getTermSize();
      this.rows = s.rows;
      this.cols = s.cols;
    });
  }

  get height(): number { return this.rows; }
  get width(): number { return this.cols; }

  /** Enter fullscreen mode */
  enter(): void {
    write(ALT_SCREEN_ON);
    write(CURSOR_HOME);
    write(CLEAR_SCREEN);
    write(CURSOR_HIDE);
    this.prev = [];
  }

  /** Exit fullscreen mode, restore terminal */
  exit(): void {
    write(CURSOR_SHOW);
    write(ALT_SCREEN_OFF);
  }

  /**
   * Render a new frame. Only writes lines that changed.
   * Lines array should have exactly this.rows entries.
   */
  render(lines: string[]): void {
    write(SYNC_START);

    for (let i = 0; i < this.rows; i++) {
      const line = lines[i] ?? "";
      if (line !== this.prev[i]) {
        write(moveToRow(i + 1));
        write(CLEAR_LINE);
        write(line);
      }
    }

    write(SYNC_END);
    this.prev = [...lines];
  }

  /** Force full redraw (e.g. after resize) */
  forceRedraw(lines: string[]): void {
    this.prev = [];
    this.render(lines);
  }

  /** Position cursor at a specific location (for input) */
  setCursor(row: number, col: number): void {
    write(`\x1b[${row};${col}H`);
    write(CURSOR_SHOW);
  }
}
