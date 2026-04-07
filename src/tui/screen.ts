import {
  ALT_SCREEN_OFF, ALT_SCREEN_ON,
  CLEAR_SCREEN, CLEAR_LINE,
  CURSOR_HOME, CURSOR_HIDE, CURSOR_SHOW, CURSOR_BLOCK, CURSOR_DEFAULT,
  SYNC_START, SYNC_END,
  moveTo, moveToRow, write, getTermSize,
} from "../utils/ansi.js";
import { getSettings } from "../core/config.js";

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
  private resizeAttached = false;
  private usingAlternateScreen = false;
  private readonly handleResize = (): void => {
    const s = getTermSize();
    this.rows = s.rows;
    this.cols = s.cols;
    this.prev = [];
  };

  constructor() {
    const size = getTermSize();
    this.rows = size.rows;
    this.cols = size.cols;
  }

  get height(): number { return this.rows; }
  get width(): number { return this.cols; }

  /** Enter the TUI in the terminal alternate buffer so it stays fullscreen. */
  enter(): void {
    if (!this.resizeAttached) {
      process.stdout.on("resize", this.handleResize);
      this.resizeAttached = true;
    }
    if (!this.usingAlternateScreen) {
      write(ALT_SCREEN_ON);
      this.usingAlternateScreen = true;
    }
    write(CURSOR_HOME);
    write(CLEAR_SCREEN);
    write(CURSOR_BLOCK);
    if (!getSettings().showHardwareCursor) write(CURSOR_HIDE);
    this.prev = [];
  }

  setAlternateScreen(enabled: boolean): void {
    if (this.usingAlternateScreen === enabled) return;
    this.usingAlternateScreen = enabled;
    write(enabled ? ALT_SCREEN_ON : ALT_SCREEN_OFF);
    write(CURSOR_HOME);
    write(CLEAR_SCREEN);
    if (!getSettings().showHardwareCursor) write(CURSOR_HIDE);
    this.prev = [];
  }

  /** Exit fullscreen mode, restore terminal */
  exit(): void {
    if (this.usingAlternateScreen) {
      write(ALT_SCREEN_OFF);
      this.usingAlternateScreen = false;
    }
    write(CURSOR_DEFAULT);
    write(CURSOR_SHOW);
  }

  dispose(): void {
    if (!this.resizeAttached) return;
    process.stdout.off("resize", this.handleResize);
    this.resizeAttached = false;
  }

  /**
   * Render a frame. Writes all lines using synchronized output
   * to prevent flicker. Always does a full write for reliability.
   */
  render(lines: string[]): void {
    let buf = SYNC_START;
    let dirty = false;
    for (let i = 0; i < this.rows; i++) {
      const next = lines[i] ?? "";
      if (this.prev[i] === next) continue;
      dirty = true;
      buf += moveToRow(i + 1) + CLEAR_LINE + next;
    }
    if (!dirty) return;
    // Hide the hardware cursor while flushing changed rows so terminals do not
    // briefly show a second caret at the last painted cell during streaming.
    buf = CURSOR_HIDE + buf;
    buf += SYNC_END;
    write(buf);
    this.prev = Array.from({ length: this.rows }, (_, i) => lines[i] ?? "");
  }

  /** Force full redraw — same as render now */
  forceRedraw(lines: string[]): void {
    this.prev = [];
    this.render(lines);
  }

  /** Position cursor at a specific location (for input) */
  setCursor(row: number, col: number): void {
    write(`\x1b[${row};${col}H`);
    write(CURSOR_BLOCK);
    write(CURSOR_SHOW);
  }

  /** Hide the cursor (during streaming, pickers, etc.) */
  hideCursor(): void {
    if (!getSettings().showHardwareCursor) write(CURSOR_HIDE);
  }

  /** Whether the terminal is wide enough for a sidebar */
  get hasSidebar(): boolean {
    return this.cols >= 58;
  }

  /** Width available for main content (excluding sidebar) */
  get mainWidth(): number {
    if (!this.hasSidebar) return this.cols;
    const sideTotal = this.sidebarWidth + 1;
    return this.cols - sideTotal;
  }

  /** Sidebar width — scales with terminal */
  get sidebarWidth(): number {
    if (this.cols >= 120) return 34;
    if (this.cols >= 90) return 30;
    if (this.cols >= 70) return 26;
    return 22;
  }
}
