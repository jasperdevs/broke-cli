import {
  ALT_SCREEN_ON, ALT_SCREEN_OFF, CLEAR_SCREEN, CLEAR_LINE,
  CURSOR_HOME, CURSOR_HIDE, CURSOR_SHOW,
  SYNC_START, SYNC_END,
  moveToRow, write, getTermSize,
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
   * Render a frame. Writes all lines using synchronized output
   * to prevent flicker. Always does a full write for reliability.
   */
  render(lines: string[]): void {
    let buf = SYNC_START;
    for (let i = 0; i < this.rows; i++) {
      buf += moveToRow(i + 1) + CLEAR_LINE + (lines[i] ?? "");
    }
    buf += SYNC_END;
    write(buf);
  }

  /** Force full redraw — same as render now */
  forceRedraw(lines: string[]): void {
    this.render(lines);
  }

  /** Position cursor at a specific location (for input) */
  setCursor(row: number, col: number): void {
    write(`\x1b[${row};${col}H`);
    write(CURSOR_SHOW);
  }

  /** Hide the cursor (during streaming, pickers, etc.) */
  hideCursor(): void {
    write(CURSOR_HIDE);
  }

  /** Whether the terminal is wide enough for a sidebar */
  get hasSidebar(): boolean {
    return this.cols >= 70;
  }

  /** Width available for main content (excluding sidebar) */
  get mainWidth(): number {
    if (!this.hasSidebar) return this.cols;
    const sideTotal = this.sidebarWidth + 3; // border + padding
    return this.cols - sideTotal;
  }

  /** Sidebar width — scales with terminal */
  get sidebarWidth(): number {
    if (this.cols >= 120) return 28;
    if (this.cols >= 90) return 24;
    return 20;
  }
}
