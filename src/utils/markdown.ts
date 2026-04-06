import { marked } from "marked";
// @ts-expect-error — marked-terminal types incomplete
import { markedTerminal } from "marked-terminal";

marked.use(
  markedTerminal({
    reflowText: true,
    width: 80,
    showSectionPrefix: false,
    tab: 2,
  }),
);

/** Render markdown to terminal-formatted string */
export function renderMarkdown(text: string): string {
  const rendered = marked.parse(text);
  if (typeof rendered !== "string") return text;
  return rendered.replace(/\n+$/, "");
}
