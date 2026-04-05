/** Parsed skill from a markdown file */
export interface Skill {
  /** Skill name (from frontmatter) */
  name: string;
  /** Description (from frontmatter) */
  description: string;
  /** The prompt template body (markdown) */
  template: string;
  /** Variables found in the template ({{var}}) */
  variables: string[];
  /** Source file path */
  filePath: string;
}

/** Render a skill template with variable values */
export function renderSkill(
  skill: Skill,
  values: Record<string, string>,
): string {
  let result = skill.template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
