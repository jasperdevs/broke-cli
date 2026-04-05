/** Context available to slash commands */
export interface CommandContext {
  /** Switch the active model */
  setModel(provider: string, model: string): void;
  /** Get current session ID */
  sessionId(): string;
  /** Print output to the user */
  print(message: string): void;
  /** Clear the chat display */
  clearDisplay(): void;
  /** Whether plan mode is active */
  planMode: boolean;
  /** Toggle plan mode */
  setPlanMode(enabled: boolean): void;
}

/** A slash command handler */
export interface SlashCommand {
  name: string;
  description: string;
  /** Optional aliases (e.g., /q for /quit) */
  aliases?: string[];
  run(args: string, ctx: CommandContext): void | Promise<void>;
}
