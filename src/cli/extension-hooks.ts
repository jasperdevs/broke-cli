export interface CliExtensionHooks {
  emit(event: string, payload: Record<string, unknown>): void | Promise<void>;
  getTools?(): Record<string, unknown>;
}
