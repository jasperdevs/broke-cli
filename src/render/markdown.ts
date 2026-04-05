import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

// Configure marked with terminal renderer
marked.use(markedTerminal() as marked.MarkedExtension);

/** Render markdown to ANSI terminal string */
export function renderMarkdown(content: string): string {
  try {
    const rendered = marked.parse(content);
    if (typeof rendered === "string") {
      // Trim trailing newlines that marked adds
      return rendered.replace(/\n+$/, "");
    }
    return content;
  } catch {
    return content;
  }
}
