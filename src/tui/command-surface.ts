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

export const COMMANDS: CommandEntry[] = [
  { name: "settings", desc: "configure options", sortPriority: -1 },
  { name: "help", desc: "open command browser" },
  { name: "login", desc: "login with subscription/oauth" },
  { name: "connect", desc: "connect api key or local endpoint" },
  { name: "logout", desc: "clear stored auth" },
  { name: "model", desc: "switch model, pin, and assign roles", hotkey: "ctrl+l" },
  { name: "mode", desc: "switch build or plan mode" },
  { name: "theme", desc: "change color theme" },
  { name: "compact", desc: "compress context" },
  { name: "update", desc: "update app" },
  { name: "budget", desc: "inspect token pressure" },
  { name: "permissions", desc: "allow or block tools" },
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
  { name: "name", desc: "name this session" },
  { name: "export", desc: "export or copy transcript" },
  { name: "copy", desc: "copy last response" },
  { name: "undo", desc: "undo last change" },
  { name: "thinking", desc: "cycle thinking", hotkey: "ctrl+t" },
  { name: "caveman", desc: "cycle token saving", hotkey: "ctrl+y" },
  { name: "clear", desc: "clear chat (new)", aliases: ["new"] },
  { name: "exit", desc: "quit", aliases: ["quit"] },
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

export function getCommandMatches(inputText: string, context?: CommandSurfaceContext): CommandEntry[] {
  if (!inputText.startsWith("/")) return [];
  const query = inputText.slice(1).toLowerCase();
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
