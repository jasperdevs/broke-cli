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
