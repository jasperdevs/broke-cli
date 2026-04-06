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
   * Render a new frame. Only writes lines that changed.
   * Lines array should have exactly this.rows entries.
   * Batches all writes into a single stdout.write for performance.
   */
  render(lines: string[]): void {
    let buf = SYNC_START;
    let changed = false;

    for (let i = 0; i < this.rows; i++) {
      const line = lines[i] ?? "";
      if (line !== this.prev[i]) {
        buf += moveToRow(i + 1) + CLEAR_LINE + line;
        this.prev[i] = line;
        changed = true;
      }
    }

    buf += SYNC_END;
    if (changed) write(buf);
    // Truncate prev if lines array is shorter
    if (this.prev.length > this.rows) this.prev.length = this.rows;
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

  /** Whether the terminal is wide enough for a sidebar */
  get hasSidebar(): boolean {
    return this.cols >= 90;
  }

  /** Width available for main content (excluding sidebar) */
  get mainWidth(): number {
    return this.hasSidebar ? this.cols - 30 : this.cols; // 30 col sidebar
  }

  /** Sidebar width */
  get sidebarWidth(): number {
    return 29; // 29 chars + 1 border
  }
}
