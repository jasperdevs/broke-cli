export interface CommandEntry {
  name: string;
  desc: string;
  aliases?: string[];
  hotkey?: string;
  sortPriority?: number;
  isVisible?: (context: { hasAgentRuns: boolean }) => boolean;
}

export const COMMANDS: CommandEntry[] = [
  { name: "settings", desc: "configure options", sortPriority: -1 },
  { name: "login", desc: "login with subscription/oauth" },
  { name: "connect", desc: "connect api key or local endpoint" },
  { name: "logout", desc: "clear stored auth" },
  { name: "model", desc: "switch model and pin for ctrl+p", hotkey: "ctrl+l" },
  { name: "theme", desc: "change color theme" },
  { name: "compact", desc: "compress context" },
  { name: "update", desc: "update brokecli itself" },
  { name: "budget", desc: "inspect token pressure" },
  { name: "permissions", desc: "allow or block tools" },
  { name: "extensions", desc: "manage extension loading" },
  { name: "skills", desc: "list loaded skills" },
  { name: "projects", desc: "switch or search recent projects" },
  { name: "resume", desc: "resume session (sessions)", aliases: ["sessions"] },
  { name: "agents", desc: "inspect delegated agent tasks", hotkey: "alt+a", isVisible: (context) => context.hasAgentRuns },
  { name: "session", desc: "show active session info" },
  { name: "hotkeys", desc: "show keyboard shortcuts" },
  { name: "reload", desc: "reload templates, context, and extensions" },
  { name: "changelog", desc: "show recent changes" },
  { name: "name", desc: "name this session" },
  { name: "export", desc: "export or copy transcript" },
  { name: "copy", desc: "copy last response" },
  { name: "undo", desc: "undo last change" },
  { name: "thinking", desc: "cycle thinking", hotkey: "ctrl+t" },
  { name: "caveman", desc: "cycle token saving", hotkey: "ctrl+y" },
  { name: "clear", desc: "clear chat (new)", aliases: ["new"] },
  { name: "exit", desc: "quit", aliases: ["quit"] },
];

export function getCommandMatches(inputText: string, context: { hasAgentRuns?: boolean } = {}): CommandEntry[] {
  if (!inputText.startsWith("/")) return [];
  const query = inputText.slice(1).toLowerCase();
  const visibleCommands = COMMANDS.filter((command) => command.isVisible?.({ hasAgentRuns: !!context.hasAgentRuns }) ?? true);
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
