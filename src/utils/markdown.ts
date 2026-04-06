import { createRequire } from "node:module";

let initialized = false;
let markedParse: ((text: string) => string) | null = null;

/** Ensure marked + marked-terminal are loaded with FORCE_COLOR set */
function ensureInit(): void {
  if (initialized) return;
  initialized = true;

  // FORCE_COLOR must be set before chalk (used by marked-terminal) initializes
  process.env.FORCE_COLOR = "3";

  try {
    // Use createRequire for ESM compatibility — loads external node_modules
    const req = createRequire(import.meta.url);
    const { marked } = req("marked");
    const { markedTerminal } = req("marked-terminal");

    marked.use(
      markedTerminal({
        reflowText: true,
        width: 80,
        showSectionPrefix: false,
        tab: 2,
      }),
    );

    markedParse = (text: string) => {
      const result = marked.parse(text);
      if (typeof result !== "string") return text;
      return result.replace(/\n+$/, "");
    };
  } catch {
    // marked/marked-terminal unavailable — fall through to plaintext
  }
}

/** Render markdown to terminal-formatted string */
export function renderMarkdown(text: string): string {
  ensureInit();
  if (markedParse) return markedParse(text);
  return text;
}
