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
