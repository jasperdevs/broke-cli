import { Screen } from "./screen.js";
import { KeypressHandler, type Keypress } from "./keypress.js";
import { InputWidget } from "./input.js";
import { renderHeader, type HeaderState } from "./header.js";
import { renderStatusBar, type StatusState } from "./status-bar.js";
import { GREEN, GRAY, RESET, BOLD, DIM, RED } from "../utils/ansi.js";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Main TUI application.
 * Composes screen, input, header, status bar, and chat area.
 */
export class App {
  private screen: Screen;
  private keypress: KeypressHandler;
  private input: InputWidget;
  private messages: ChatMessage[] = [];
  private headerState: HeaderState;
  private statusState: StatusState = { isStreaming: false };
  private ctrlCCount = 0;
  private ctrlCTimeout: ReturnType<typeof setTimeout> | null = null;
  private scrollOffset = 0;
  private onSubmit: ((text: string) => void) | null = null;
  private running = false;

  constructor() {
    this.screen = new Screen();
    this.input = new InputWidget();
    this.headerState = {
      model: "none",
      provider: "—",
      cost: 0,
      tokens: 0,
      isStreaming: false,
    };

    this.keypress = new KeypressHandler(
      (key) => this.handleKey(key),
      (text) => this.handlePaste(text),
    );
  }

  /** Set the model info displayed in header */
  setModel(provider: string, model: string): void {
    this.headerState.provider = provider;
    this.headerState.model = model;
    this.draw();
  }

  /** Update cost/token display */
  updateCost(cost: number, tokens: number): void {
    this.headerState.cost = cost;
    this.headerState.tokens = tokens;
    this.draw();
  }

  /** Set streaming state */
  setStreaming(streaming: boolean): void {
    this.headerState.isStreaming = streaming;
    this.statusState.isStreaming = streaming;
    this.draw();
  }

  /** Add a message to the chat */
  addMessage(role: "user" | "assistant" | "system", content: string): void {
    this.messages.push({ role, content });
    this.scrollToBottom();
    this.draw();
  }

  /** Append text to the last assistant message (for streaming) */
  appendToLastMessage(text: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === "assistant") {
      last.content += text;
    } else {
      this.messages.push({ role: "assistant", content: text });
    }
    this.scrollToBottom();
    this.draw();
  }

  /** Set status bar message */
  setStatus(message: string): void {
    this.statusState.message = message;
    this.draw();
  }

  private scrollToBottom(): void {
    const chatHeight = this.screen.height - 4; // header(1) + input(1) + status(1) + border(1)
    const messageLines = this.renderMessages();
    this.scrollOffset = Math.max(0, messageLines.length - chatHeight);
  }

  private handleKey(key: Keypress): void {
    // Double Ctrl+C to exit
    if (key.ctrl && key.name === "c") {
      this.ctrlCCount++;
      if (this.ctrlCCount >= 2) {
        this.stop();
        return;
      }
      this.setStatus(`${RED}Press Ctrl+C again to exit${RESET}`);
      if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
      this.ctrlCTimeout = setTimeout(() => {
        this.ctrlCCount = 0;
        this.statusState.message = undefined;
        this.draw();
      }, 1500);
      return;
    }

    // Reset Ctrl+C count on any other key
    this.ctrlCCount = 0;

    // Scroll up/down with Page keys
    if (key.name === "pageup") {
      this.scrollOffset = Math.max(0, this.scrollOffset - 5);
      this.draw();
      return;
    }
    if (key.name === "pagedown") {
      this.scrollToBottom();
      this.draw();
      return;
    }

    // Forward to input widget
    const action = this.input.handleKey(key);
    if (action === "submit") {
      const text = this.input.submit();
      if (text && this.onSubmit) {
        this.onSubmit(text);
      }
    }
    this.draw();
  }

  private handlePaste(text: string): void {
    this.input.paste(text);
    this.draw();
  }

  /** Render all messages as an array of terminal lines */
  private renderMessages(): string[] {
    const lines: string[] = [];
    const width = this.screen.width;

    for (const msg of this.messages) {
      // Role label
      if (msg.role === "user") {
        lines.push(`${BOLD}${GREEN}❯ you${RESET}`);
      } else if (msg.role === "assistant") {
        lines.push(`${BOLD}${GREEN}◆ brokecli${RESET}`);
      } else {
        lines.push(`${DIM}ℹ system${RESET}`);
      }

      // Content — wrap to terminal width (simple word wrap)
      const contentLines = msg.content.split("\n");
      for (const cl of contentLines) {
        if (cl.length <= width - 2) {
          lines.push(`  ${cl}`);
        } else {
          // Simple wrap
          for (let i = 0; i < cl.length; i += width - 2) {
            lines.push(`  ${cl.slice(i, i + width - 2)}`);
          }
        }
      }
      lines.push(""); // blank line between messages
    }

    return lines;
  }

  /** Build the full screen buffer and render */
  private draw(): void {
    const { height, width } = this.screen;
    const lines: string[] = [];

    // 1. Header (row 1)
    lines.push(renderHeader(this.headerState, width));

    // 2. Separator
    lines.push(`${GREEN}${"─".repeat(width)}${RESET}`);

    // 3. Chat area (fills remaining space)
    const chatHeight = height - 4; // header + separator + input + status
    const messageLines = this.renderMessages();
    const visible = messageLines.slice(this.scrollOffset, this.scrollOffset + chatHeight);

    for (let i = 0; i < chatHeight; i++) {
      lines.push(visible[i] ?? "");
    }

    // 4. Input line
    const inputText = this.input.getText();
    const cursor = this.input.getCursor();
    if (this.headerState.isStreaming) {
      lines.push(`${DIM}  waiting for response...${RESET}`);
    } else if (inputText) {
      lines.push(`${GREEN}❯${RESET} ${inputText}`);
    } else {
      lines.push(`${GREEN}❯${RESET} ${DIM}Ask anything...${RESET}`);
    }

    // 5. Status bar
    lines.push(renderStatusBar(this.statusState, width));

    this.screen.render(lines);

    // Position cursor in input area
    if (!this.headerState.isStreaming) {
      const inputRow = height - 1; // 1-based, second to last line
      const inputCol = 3 + cursor; // "❯ " = 2 chars + 1-based
      this.screen.setCursor(inputRow, inputCol);
    }
  }

  /** Register callback for when user submits input */
  onInput(handler: (text: string) => void): void {
    this.onSubmit = handler;
  }

  /** Start the TUI */
  start(): void {
    this.running = true;
    this.screen.enter();
    this.keypress.start();
    this.draw();

    // Handle resize
    process.stdout.on("resize", () => {
      this.screen.forceRedraw([]); // clear prev buffer
      this.draw();
    });
  }

  /** Stop the TUI and restore terminal */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.keypress.stop();
    this.screen.exit();

    // Show exit message
    console.log(`\n${GREEN}${BOLD}brokecli${RESET} — session ended`);
    console.log(`${DIM}Cost: $${this.headerState.cost.toFixed(4)} | Tokens: ${this.headerState.tokens}${RESET}\n`);

    process.exit(0);
  }
}
