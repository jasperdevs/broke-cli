import { readFileSync } from "fs";
import { listSkills as listSkillResources, loadSkill } from "./resources.js";

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  baseDir: string;
  source: string;
}

export function listSkills(): SkillInfo[] {
  return listSkillResources().map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: skill.path,
    baseDir: skill.baseDir,
    source: skill.source,
  }));
}

export function loadSkillPrompt(name: string): string | null {
  const skill = loadSkill(name);
  if (!skill) return null;
  try {
    return readFileSync(skill.path, "utf-8");
  } catch {
    return null;
  }
}

function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return match ? match[1] : raw;
}

function buildSkillBlock(skillName: string): { block?: string; skillName?: string; skillPath?: string } {
  const skill = loadSkill(skillName);
  if (!skill) return {};
  const raw = loadSkillPrompt(skillName);
  if (!raw) return {};
  const body = stripFrontmatter(raw).trim();
  return {
    block: [
      `<skill name="${skill.name}" location="${skill.path}">`,
      `References are relative to ${skill.baseDir}.`,
      "",
      body,
      "</skill>",
    ].join("\n"),
    skillName: skill.name,
    skillPath: skill.path,
  };
}

export function expandSkillInvocation(text: string): { expandedText: string; skillName?: string; skillPath?: string } {
  const trimmedStart = text.trimStart();
  const leadingWhitespace = text.slice(0, text.length - trimmedStart.length);
  const dollarMatch = trimmedStart.match(/^\$([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  const slashMatch = trimmedStart.match(/^\/skill:([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  const match = dollarMatch ?? slashMatch;
  if (!match) return { expandedText: text };

  const skillName = match[1];
  const args = match[2]?.trim() ?? "";
  const { block: skillBlock, skillName: resolvedName, skillPath } = buildSkillBlock(skillName);
  if (!skillBlock || !resolvedName) return { expandedText: text };
  return {
    expandedText: args ? `${leadingWhitespace}${skillBlock}\n\n${args}` : `${leadingWhitespace}${skillBlock}`,
    skillName: resolvedName,
    skillPath,
  };
}

export function expandInlineSkillInvocations(text: string): { expandedText: string; skillName?: string; skillPath?: string } {
  const direct = expandSkillInvocation(text);
  if (direct.skillName) return direct;
  const match = text.match(/(^|\s)\$([a-zA-Z0-9_-]+)\b/);
  if (!match || match.index === undefined) return { expandedText: text };
  const skillTokenStart = match.index + match[1].length;
  const skillTokenEnd = skillTokenStart + match[2].length + 1;
  const { block, skillName, skillPath } = buildSkillBlock(match[2]);
  if (!block || !skillName) return { expandedText: text };
  const promptWithoutToken = `${text.slice(0, skillTokenStart)}${text.slice(skillTokenEnd)}`.replace(/[ \t]{2,}/g, " ").trim();
  return {
    expandedText: promptWithoutToken ? `${block}\n\n${promptWithoutToken}` : block,
    skillName,
    skillPath,
  };
}
