import { Screen } from "./screen.js";
import { KeypressHandler, type Keypress } from "./keypress.js";
import { InputWidget } from "./input.js";
import { renderHeader, type HeaderState } from "./header.js";
import { renderStatusBar, type StatusState } from "./status-bar.js";
import { GREEN, GRAY, RESET, BOLD, DIM, RED, WHITE } from "../utils/ansi.js";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// BrokeCLI logo — traced from Silkscreen Bold pixel font (brokecli-text-v1.svg)
const LOGO = [
  `${GREEN}████                 █  █           ████  █      ███${RESET}`,
  `${GREEN}█   █  █ ██    ███   █ █     ███   █      █       █${RESET}`,
  `${GREEN}████   ██     █   █  ██     ████   █      █       █${RESET}`,
  `${GREEN}█   █  █      █   █  █ █    █      █      █       █${RESET}`,
  `${GREEN}████   █       ███   █  █    ███    ████  █████  ███${RESET}`,
];

// Available slash commands
const COMMANDS = [
  { name: "help", desc: "show commands" },
  { name: "model", desc: "switch model" },
  { name: "setup", desc: "add provider" },
  { name: "cost", desc: "session spend" },
  { name: "clear", desc: "clear chat" },
  { name: "exit", desc: "quit" },
];

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

  /** Get matching commands for current input */
  private getCommandSuggestions(): string[] {
    const text = this.input.getText();
    if (!text.startsWith("/")) return [];
    const query = text.slice(1).toLowerCase();
    return COMMANDS
      .filter((c) => c.name.startsWith(query))
      .map((c) => `  ${GREEN}/${c.name}${RESET}  ${DIM}${c.desc}${RESET}`);
  }

  /** Build the full screen buffer and render */
  private draw(): void {
    const { height, width } = this.screen;
    const lines: string[] = [];
    const inputText = this.input.getText();
    const cursor = this.input.getCursor();
    const isHome = this.messages.length === 0;
    const suggestions = this.getCommandSuggestions();

    // 1. Header (row 1)
    lines.push(renderHeader(this.headerState, width));

    // 2. Separator
    lines.push(`${GREEN}${"─".repeat(width)}${RESET}`);

    // 3. Content area
    const reservedBottom = 2 + suggestions.length; // input + status + suggestions
    const chatHeight = height - 2 - reservedBottom; // header + separator + bottom

    if (isHome) {
      // Home screen — logo top left, then empty space, input at bottom
      for (const logoLine of LOGO) {
        lines.push(` ${logoLine}`);
      }
      lines.push(`${DIM} AI coding that doesn't waste your money${RESET}`);
      lines.push("");

      // Fill remaining with empty
      const filled = LOGO.length + 2;
      for (let i = filled; i < chatHeight; i++) lines.push("");
    } else {
      // Chat view — messages
      const messageLines = this.renderMessages();
      const visible = messageLines.slice(this.scrollOffset, this.scrollOffset + chatHeight);
      for (let i = 0; i < chatHeight; i++) {
        lines.push(visible[i] ?? "");
      }
    }

    // 4. Command suggestions (shown above input when typing /)
    for (const s of suggestions) {
      lines.push(s);
    }

    // 5. Input line
    if (this.headerState.isStreaming) {
      lines.push(`${DIM}  waiting for response...${RESET}`);
    } else if (inputText) {
      lines.push(`${GREEN}❯${RESET} ${inputText}`);
    } else {
      lines.push(`${GREEN}❯${RESET} ${DIM}Ask anything... "Fix broken tests"${RESET}`);
    }

    // 6. Status bar
    lines.push(renderStatusBar(this.statusState, width));

    this.screen.render(lines);

    // Position cursor in input area
    if (!this.headerState.isStreaming) {
      const inputRow = height - 1; // second to last line (1-based)
      const inputCol = 3 + cursor;
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

    // Show exit with logo
    console.log("");
    for (const line of LOGO) console.log(line);
    console.log(`${DIM}Session ended · $${this.headerState.cost.toFixed(4)} · ${this.headerState.tokens} tokens${RESET}`);
    console.log("");

    process.exit(0);
  }
}
