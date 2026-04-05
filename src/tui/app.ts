import { Screen } from "./screen.js";
import { KeypressHandler, type Keypress } from "./keypress.js";
import { InputWidget } from "./input.js";
import { GREEN, GRAY, RESET, BOLD, DIM, RED, WHITE, moveTo } from "../utils/ansi.js";
import stripAnsi from "strip-ansi";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// BrokeCLI logo — Silkscreen Bold pixel font (from brokecli-text-v1.svg)
const LOGO = [
  "████                 █  █           ████  █      ███",
  "█   █  █ ██    ███   █ █     ███   █      █       █",
  "████   ██     █   █  ██     ████   █      █       █",
  "█   █  █      █   █  █ █    █      █      █       █",
  "████   █       ███   █  █    ███    ████  █████  ███",
];

const COMMANDS = [
  { name: "help", desc: "show commands" },
  { name: "model", desc: "switch model" },
  { name: "setup", desc: "add provider" },
  { name: "cost", desc: "session spend" },
  { name: "clear", desc: "clear chat" },
  { name: "exit", desc: "quit" },
];

export class App {
  private screen: Screen;
  private keypress: KeypressHandler;
  private input: InputWidget;
  private messages: ChatMessage[] = [];
  private sessionCost = 0;
  private sessionTokens = 0;
  private contextUsed = 0; // percentage
  private modelName = "none";
  private providerName = "—";
  private isStreaming = false;
  private ctrlCCount = 0;
  private ctrlCTimeout: ReturnType<typeof setTimeout> | null = null;
  private scrollOffset = 0;
  private onSubmit: ((text: string) => void) | null = null;
  private running = false;
  private statusMessage: string | undefined;
  private detectedProviders: string[] = [];
  private sessionId = new Date().toISOString();
  private cwd = process.cwd();

  constructor() {
    this.screen = new Screen();
    this.input = new InputWidget();
    this.keypress = new KeypressHandler(
      (key) => this.handleKey(key),
      (text) => this.handlePaste(text),
    );
  }

  setModel(provider: string, model: string): void {
    this.providerName = provider;
    this.modelName = model;
    this.draw();
  }

  updateCost(cost: number, tokens: number): void {
    this.sessionCost = cost;
    this.sessionTokens = tokens;
    this.draw();
  }

  setContextUsed(pct: number): void {
    this.contextUsed = pct;
    this.draw();
  }

  setStreaming(streaming: boolean): void {
    this.isStreaming = streaming;
    this.draw();
  }

  setDetectedProviders(providers: string[]): void {
    this.detectedProviders = providers;
  }

  addMessage(role: "user" | "assistant" | "system", content: string): void {
    this.messages.push({ role, content });
    this.scrollToBottom();
    this.draw();
  }

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

  setStatus(message: string): void {
    this.statusMessage = message;
    this.draw();
  }

  private scrollToBottom(): void {
    const chatHeight = this.getChatHeight();
    const messageLines = this.renderMessages(this.screen.mainWidth - 2);
    this.scrollOffset = Math.max(0, messageLines.length - chatHeight);
  }

  private getChatHeight(): number {
    return this.screen.height - 3; // status(1) + input(1) + suggestions area(1 max)
  }

  private handleKey(key: Keypress): void {
    if (key.ctrl && key.name === "c") {
      this.ctrlCCount++;
      if (this.ctrlCCount >= 2) { this.stop(); return; }
      this.statusMessage = `${RED}Press Ctrl+C again to exit${RESET}`;
      this.draw();
      if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
      this.ctrlCTimeout = setTimeout(() => {
        this.ctrlCCount = 0;
        this.statusMessage = undefined;
        this.draw();
      }, 1500);
      return;
    }
    this.ctrlCCount = 0;

    if (key.name === "pageup") { this.scrollOffset = Math.max(0, this.scrollOffset - 5); this.draw(); return; }
    if (key.name === "pagedown") { this.scrollToBottom(); this.draw(); return; }

    // Tab to autocomplete first command suggestion
    if (key.name === "tab") {
      const text = this.input.getText();
      if (text.startsWith("/")) {
        const query = text.slice(1).toLowerCase();
        const match = COMMANDS.find((c) => c.name.startsWith(query));
        if (match) {
          this.input.clear();
          this.input.paste(`/${match.name}`);
        }
      }
      this.draw();
      return;
    }

    const action = this.input.handleKey(key);
    if (action === "submit") {
      const text = this.input.submit();
      if (text && this.onSubmit) this.onSubmit(text);
    }
    this.draw();
  }

  private handlePaste(text: string): void {
    this.input.paste(text);
    this.draw();
  }

  /** Render messages as terminal lines */
  private renderMessages(maxWidth: number): string[] {
    const lines: string[] = [];
    for (const msg of this.messages) {
      if (msg.role === "user") {
        lines.push(`${BOLD}${WHITE}  ❯ ${msg.content}${RESET}`);
      } else if (msg.role === "assistant") {
        lines.push(`${GREEN}  ◆ ${this.modelName}${RESET}`);
        for (const cl of msg.content.split("\n")) {
          if (cl.length <= maxWidth - 4) {
            lines.push(`    ${cl}`);
          } else {
            for (let i = 0; i < cl.length; i += maxWidth - 4) {
              lines.push(`    ${cl.slice(i, i + maxWidth - 4)}`);
            }
          }
        }
      } else {
        lines.push(`${DIM}  ℹ ${msg.content}${RESET}`);
      }
      lines.push("");
    }
    return lines;
  }

  /** Render the sidebar content */
  private renderSidebar(): string[] {
    const w = this.screen.sidebarWidth;
    const lines: string[] = [];
    const sep = `${GREEN}${"─".repeat(w)}${RESET}`;

    // Session header
    lines.push(`${GREEN}${BOLD} Session${RESET}`);
    lines.push(`${DIM} ${this.sessionId.slice(0, w - 2)}${RESET}`);
    lines.push("");

    // Context
    lines.push(`${GREEN}${BOLD} Context${RESET}`);
    lines.push(`${DIM} ${this.sessionTokens} tokens${RESET}`);
    lines.push(`${DIM} ${this.contextUsed}% used${RESET}`);
    lines.push(`${GREEN} $${this.sessionCost.toFixed(4)} spent${RESET}`);
    lines.push("");

    // Model
    lines.push(`${GREEN}${BOLD} Model${RESET}`);
    lines.push(` ${this.providerName}/${this.modelName}`);
    lines.push("");

    // Providers
    if (this.detectedProviders.length > 0) {
      lines.push(`${GREEN}${BOLD} Providers${RESET}`);
      for (const p of this.detectedProviders) {
        lines.push(`${GREEN} ● ${RESET}${p}`);
      }
      lines.push("");
    }

    // Working dir
    lines.push(`${GREEN}${BOLD} Working Dir${RESET}`);
    const shortCwd = this.cwd.length > w - 3
      ? "..." + this.cwd.slice(-(w - 6))
      : this.cwd;
    lines.push(`${DIM} ${shortCwd}${RESET}`);

    // Fill remaining height
    const remaining = this.screen.height - 2 - lines.length; // -2 for status+input
    for (let i = 0; i < remaining; i++) lines.push("");

    // Bottom
    lines.push(`${DIM} /help for commands${RESET}`);

    return lines;
  }

  /** Pad or truncate a visible string to a target width */
  private padLine(line: string, targetWidth: number): string {
    const visible = stripAnsi(line).length;
    if (visible >= targetWidth) return line;
    return line + " ".repeat(targetWidth - visible);
  }

  /** Build and render a frame */
  private draw(): void {
    const { height, width } = this.screen;
    const hasSidebar = this.screen.hasSidebar && this.messages.length > 0;
    const mainW = hasSidebar ? this.screen.mainWidth : width;
    const inputText = this.input.getText();
    const cursor = this.input.getCursor();
    const isHome = this.messages.length === 0;
    const suggestions = this.getCommandSuggestions();

    const frameLines: string[] = [];

    if (isHome) {
      // Home: logo top-left, rest empty, input at bottom
      for (const l of LOGO) {
        frameLines.push(` ${GREEN}${l}${RESET}`);
      }
      frameLines.push(`${DIM} AI coding that doesn't waste your money${RESET}`);
      frameLines.push("");

      // Fill to input area
      const filled = LOGO.length + 2;
      const chatH = height - 2 - suggestions.length; // status + input + suggestions
      for (let i = filled; i < chatH; i++) frameLines.push("");

    } else {
      // Chat mode
      const chatH = height - 2 - suggestions.length;
      const messageLines = this.renderMessages(mainW);
      const visible = messageLines.slice(this.scrollOffset, this.scrollOffset + chatH);

      if (hasSidebar) {
        // Merge chat lines with sidebar
        const sidebarLines = this.renderSidebar();
        const border = `${GREEN}│${RESET}`;

        for (let i = 0; i < chatH; i++) {
          const chatLine = this.padLine(visible[i] ?? "", mainW);
          const sidebarLine = sidebarLines[i] ?? "";
          const paddedSidebar = this.padLine(sidebarLine, this.screen.sidebarWidth);
          frameLines.push(`${chatLine}${border}${paddedSidebar}`);
        }
      } else {
        for (let i = 0; i < chatH; i++) {
          frameLines.push(visible[i] ?? "");
        }
      }
    }

    // Command suggestions
    for (const s of suggestions) {
      frameLines.push(s);
    }

    // Input line
    if (this.isStreaming) {
      frameLines.push(`${GREEN} ● ${RESET}${DIM}generating...${RESET}`);
    } else if (inputText) {
      frameLines.push(`${GREEN} ❯ ${RESET}${inputText}`);
    } else {
      frameLines.push(`${GREEN} ❯ ${RESET}${DIM}Ask anything... "Fix broken tests"${RESET}`);
    }

    // Status bar
    const statusLeft = this.statusMessage
      ? ` ${this.statusMessage}`
      : `${DIM} ${this.providerName}/${this.modelName}  ${GREEN}$${this.sessionCost.toFixed(4)}${RESET}  ${DIM}${this.sessionTokens} tok${RESET}`;
    const statusRight = `${DIM}/help commands  ctrl+c exit${RESET} `;
    frameLines.push(`${statusLeft}${"  "}${statusRight}`);

    this.screen.render(frameLines);

    // Cursor position
    if (!this.isStreaming) {
      const inputRow = height - 1;
      const inputCol = 4 + cursor; // " ❯ " = 3 chars + 1-based
      this.screen.setCursor(inputRow, inputCol);
    }
  }

  private getCommandSuggestions(): string[] {
    const text = this.input.getText();
    if (!text.startsWith("/")) return [];
    const query = text.slice(1).toLowerCase();
    if (!query && text === "/") {
      // Show all commands
      return COMMANDS.map((c) => `   ${GREEN}/${c.name}${RESET}  ${DIM}${c.desc}${RESET}`);
    }
    const matches = COMMANDS.filter((c) => c.name.startsWith(query) && c.name !== query);
    if (matches.length === 0) return [];
    return matches.map((c) => `   ${GREEN}/${c.name}${RESET}  ${DIM}${c.desc}${RESET}`);
  }

  onInput(handler: (text: string) => void): void {
    this.onSubmit = handler;
  }

  start(): void {
    this.running = true;
    this.screen.enter();
    this.keypress.start();
    this.draw();

    process.stdout.on("resize", () => {
      this.screen.forceRedraw([]);
      this.draw();
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.keypress.stop();
    this.screen.exit();

    // Exit message
    console.log("");
    for (const l of LOGO) console.log(` ${GREEN}${l}${RESET}`);
    console.log(`${DIM} Session ended · $${this.sessionCost.toFixed(4)} · ${this.sessionTokens} tokens${RESET}`);
    console.log("");
    process.exit(0);
  }
}
