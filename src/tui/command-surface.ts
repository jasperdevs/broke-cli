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

export const COMMANDS: CommandEntry[] = [
  { name: "settings", desc: "configure options", aliases: ["set"], sortPriority: -1 },
  { name: "login", desc: "login with subscription/oauth" },
  { name: "connect", desc: "connect api key or local endpoint" },
  { name: "logout", desc: "clear stored auth" },
  { name: "model", desc: "switch model and assign routing slots", hotkey: "ctrl+l" },
  { name: "btw", desc: "ask an ephemeral side question" },
  { name: "mode", desc: "switch build or plan mode" },
  { name: "compact", desc: "compress context" },
  { name: "update", desc: "update app" },
  { name: "budget", desc: "inspect token pressure" },
  { name: "extensions", desc: "manage extension loading" },
  { name: "skills", desc: "list loaded skills" },
  { name: "projects", desc: "switch or search recent projects" },
  { name: "resume", desc: "resume session (sessions)", aliases: ["sessions"] },
  { name: "tree", desc: "jump to any point in session history" },
  { name: "fork", desc: "branch from current session" },
  { name: "session", desc: "show active session info" },
  { name: "hotkeys", desc: "show keyboard shortcuts" },
  { name: "reload", desc: "reload templates, context, and extensions" },
  { name: "changelog", desc: "show recent changes" },
  { name: "templates", desc: "browse slash templates" },
  { name: "name", desc: "rename this session" },
  { name: "export", desc: "export or copy transcript" },
  { name: "copy", desc: "copy last response" },
  { name: "undo", desc: "undo last change" },
  { name: "thinking", desc: "cycle thinking", hotkey: "ctrl+t" },
  { name: "caveman", desc: "cycle token saving", hotkey: "ctrl+y" },
  { name: "clear", desc: "clear chat (new)", aliases: ["new"] },
  { name: "quit", desc: "quit" },
];

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
