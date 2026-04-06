import { createRequire } from "node:module";

let initialized = false;
let markedParse: ((text: string) => string) | null = null;

// Our brand green in ANSI 24-bit
const BRAND_GREEN = "\x1b[38;2;58;199;58m";

/** Replace cyan/turquoise ANSI codes with our brand green */
function replaceCyanWithGreen(text: string): string {
  // Replace 8-bit cyan (color 36, 96)
  text = text.replace(/\x1b\[36m/g, BRAND_GREEN);
  text = text.replace(/\x1b\[96m/g, BRAND_GREEN);
  // Replace 24-bit cyan-ish colors (r<80, g>150, b>150)
  text = text.replace(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g, (_match, r, g, b) => {
    const ri = parseInt(r, 10), gi = parseInt(g, 10), bi = parseInt(b, 10);
    if (ri < 80 && gi > 150 && bi > 150) return BRAND_GREEN;
    return _match;
  });
  return text;
}

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
      // Strip trailing newlines, replace cyan with brand green
      return replaceCyanWithGreen(result.replace(/\n+$/, ""));
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
