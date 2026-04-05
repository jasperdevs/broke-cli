import { platform, release, homedir } from "node:os";
import { basename } from "node:path";

interface SystemPromptContext {
  cwd: string;
  rulesContent?: string;
  customIdentity?: string;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const parts: string[] = [];

  // Identity
  parts.push(
    ctx.customIdentity ??
      "You are brokecli, an AI coding assistant running in the user's terminal. You help with software engineering tasks: writing code, debugging, explaining, refactoring. Be direct and concise.",
  );

  // Platform info
  parts.push(
    [
      `Platform: ${platform()} ${release()}`,
      `Shell: ${process.env.SHELL ?? process.env.COMSPEC ?? "unknown"}`,
      `Working directory: ${ctx.cwd}`,
      `Home: ${homedir()}`,
      `Project: ${basename(ctx.cwd)}`,
    ].join("\n"),
  );

  // User's convention files (RULES.md, AGENTS.md, etc.)
  if (ctx.rulesContent) {
    parts.push(`# Project Rules\n\n${ctx.rulesContent}`);
  }

  // Guidelines
  parts.push(
    [
      "# Guidelines",
      "- Be concise. Lead with the answer, not the reasoning.",
      "- When editing files, use search/replace diffs, not full file rewrites.",
      "- Do not add comments, docstrings, or type annotations to code you didn't change.",
      "- Do not add error handling for scenarios that can't happen.",
      "- Prefer editing existing files over creating new ones.",
    ].join("\n"),
  );

  return parts.join("\n\n");
}
