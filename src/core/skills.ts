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

export function expandSkillInvocation(text: string): { expandedText: string; skillName?: string; skillPath?: string } {
  const trimmedStart = text.trimStart();
  const leadingWhitespace = text.slice(0, text.length - trimmedStart.length);
  const dollarMatch = trimmedStart.match(/^\$([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  const slashMatch = trimmedStart.match(/^\/skill:([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  const match = dollarMatch ?? slashMatch;
  if (!match) return { expandedText: text };

  const skillName = match[1];
  const args = match[2]?.trim() ?? "";
  const skill = loadSkill(skillName);
  if (!skill) return { expandedText: text };

  const raw = loadSkillPrompt(skillName);
  if (!raw) return { expandedText: text };

  const body = stripFrontmatter(raw).trim();
  const skillBlock = [
    `<skill name="${skill.name}" location="${skill.path}">`,
    `References are relative to ${skill.baseDir}.`,
    "",
    body,
    "</skill>",
  ].join("\n");
  return {
    expandedText: args ? `${leadingWhitespace}${skillBlock}\n\n${args}` : `${leadingWhitespace}${skillBlock}`,
    skillName: skill.name,
    skillPath: skill.path,
  };
}
