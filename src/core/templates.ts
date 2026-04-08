import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { listPromptTemplates, loadPromptTemplate } from "./resources.js";

interface TemplateInfo {
  name: string;
  description: string;
  path: string;
}

export function listTemplates(): TemplateInfo[] {
  return listPromptTemplates().map((template) => ({
    name: template.name,
    description: template.description,
    path: template.path,
  }));
}

export function loadTemplate(name: string): string | null {
  return loadPromptTemplate(name);
}

export function createTemplate(name: string, body?: string): string {
  const safeName = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safeName) throw new Error("Template name cannot be empty.");
  const dir = join(homedir(), ".brokecli", "prompts");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${safeName}.md`);
  const content = body?.trim().length
    ? body.trimEnd()
    : `---\nname: ${safeName}\ndescription: ${safeName}\n---\n\n{{input}}\n`;
  writeFileSync(filePath, `${content}\n`, "utf-8");
  return filePath;
}
