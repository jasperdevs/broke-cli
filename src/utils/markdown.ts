import type { MarkedExtension } from "marked";

let initialized = false;
let markedParse: ((text: string) => string) | null = null;

/** Ensure marked + marked-terminal are loaded with FORCE_COLOR set */
function ensureInit(): void {
  if (initialized) return;
  initialized = true;

  // FORCE_COLOR must be set before chalk (used by marked-terminal) initializes
  process.env.FORCE_COLOR = "3";

  try {
    // Use require() to load synchronously after env is set
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { marked } = require("marked");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { markedTerminal } = require("marked-terminal");

    marked.use(
      markedTerminal({
        reflowText: true,
        width: 80,
        showSectionPrefix: false,
        tab: 2,
      }) as MarkedExtension,
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
