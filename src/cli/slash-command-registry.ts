export interface RegisteredSlashCommand<TContext, TResult> {
  names: string[];
  run: (context: TContext) => Promise<TResult> | TResult;
}

export function createSlashCommandRegistry<TContext, TResult>(
  commands: ReadonlyArray<RegisteredSlashCommand<TContext, TResult>>,
): Map<string, (context: TContext) => Promise<TResult> | TResult> {
  const registry = new Map<string, (context: TContext) => Promise<TResult> | TResult>();
  for (const command of commands) {
    for (const name of command.names) registry.set(name, command.run);
  }
  return registry;
}
