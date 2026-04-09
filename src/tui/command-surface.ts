import { CORE_SLASH_COMMAND_SPECS } from "../cli/slash-commands.js";
import { UI_SLASH_COMMAND_SPECS } from "../cli/slash-command-ui.js";

export interface CommandEntry {
  name: string;
  desc: string;
  aliases?: string[];
  hotkey?: string;
  sortPriority?: number;
}

export interface CommandSurfaceContext {
  hasMessages?: boolean;
  hasAssistantContent?: boolean;
  canResume?: boolean;
  hasStoredAuth?: boolean;
}

export interface ParsedCommandInput {
  raw: string;
  command: string;
  args: string;
  hasArgs: boolean;
}

function toCommandEntry(spec: {
  names: string[];
  description?: string;
  hotkey?: string;
  sortPriority?: number;
  pickerName?: string;
  showInPicker?: boolean;
}): CommandEntry {
  if (spec.showInPicker === false) return null as never;
  const primaryName = spec.pickerName ?? spec.names[0]!;
  return {
    name: primaryName,
    aliases: spec.names.filter((name) => name !== primaryName),
    desc: spec.description ?? primaryName,
    hotkey: spec.hotkey,
    sortPriority: spec.sortPriority,
  };
}

export const COMMANDS: CommandEntry[] = [
  ...CORE_SLASH_COMMAND_SPECS,
  ...UI_SLASH_COMMAND_SPECS,
].filter((spec) => spec.showInPicker !== false).map(toCommandEntry);

function isCommandVisible(command: CommandEntry, context?: CommandSurfaceContext): boolean {
  switch (command.name) {
    case "copy":
      return !!context?.hasAssistantContent;
    case "logout":
      return !!context?.hasStoredAuth;
    case "resume":
      return context?.canResume ?? true;
    case "fork":
      return context?.hasMessages ?? true;
    default:
      return true;
  }
}

export function parseCommandInput(inputText: string): ParsedCommandInput | null {
  if (!inputText.startsWith("/")) return null;
  const body = inputText.slice(1);
  const firstSpace = body.search(/\s/);
  if (firstSpace < 0) {
    return {
      raw: body,
      command: body.toLowerCase(),
      args: "",
      hasArgs: false,
    };
  }
  const command = body.slice(0, firstSpace).toLowerCase();
  const args = body.slice(firstSpace + 1);
  return {
    raw: body,
    command,
    args,
    hasArgs: args.trim().length > 0,
  };
}

export function getCommandMatches(inputText: string, context?: CommandSurfaceContext): CommandEntry[] {
  const parsed = parseCommandInput(inputText);
  if (!parsed) return [];
  if (parsed.raw.includes(" ")) return [];
  const query = parsed.command;
  const visibleCommands = COMMANDS.filter((command) => isCommandVisible(command, context));
  const matches = (!query && inputText === "/") ? [...visibleCommands] : visibleCommands.filter((c) => {
    const matchesName = c.name.startsWith(query) && c.name !== query;
    const matchesAlias = c.aliases?.some((alias) => alias.startsWith(query)) ?? false;
    return matchesName || matchesAlias;
  });
  return matches.sort((a, b) => {
    const priorityDelta = (a.sortPriority ?? 0) - (b.sortPriority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return visibleCommands.indexOf(a) - visibleCommands.indexOf(b);
  });
}

export function resolveSlashCommandName(inputText: string, context?: CommandSurfaceContext): string | null {
  const parsed = parseCommandInput(inputText);
  if (!parsed) return null;
  const visibleCommands = COMMANDS.filter((command) => isCommandVisible(command, context));
  const exact = visibleCommands.find((command) =>
    command.name === parsed.command || command.aliases?.includes(parsed.command),
  );
  if (exact) return exact.name;

  if (parsed.hasArgs) return null;
  const matches = getCommandMatches(`/${parsed.command}`, context);
  return matches.length === 1 ? matches[0]!.name : null;
}

export function canonicalizeSlashInput(inputText: string, context?: CommandSurfaceContext): string {
  const parsed = parseCommandInput(inputText);
  if (!parsed) return inputText;
  const resolved = resolveSlashCommandName(inputText, context);
  if (!resolved) return inputText;
  const suffix = parsed.raw.slice(parsed.command.length);
  return `/${resolved}${suffix}`;
}
