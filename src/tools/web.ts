import { z } from "zod";
import { tool } from "ai";

const MAX_WEB_FETCH_CHARS = 6000;

export const webSearchTool = tool({
  description: "Search the web via DuckDuckGo. Use for: current docs, recent events, API references, things you don't know. Do NOT search for things you already know or can find in the codebase with grep.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    // Try multiple free search APIs
    try {
      // DuckDuckGo instant answer API (no key needed)
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json() as {
        Abstract?: string;
        AbstractText?: string;
        AbstractURL?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };

      const results: string[] = [];
      if (data.AbstractText) {
        results.push(`${data.AbstractText}\nSource: ${data.AbstractURL ?? ""}`);
      }
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, 5)) {
          if (topic.Text) {
            results.push(`${topic.Text}${topic.FirstURL ? `\n  ${topic.FirstURL}` : ""}`);
          }
        }
      }
      if (results.length === 0) {
        return { success: true as const, results: `No instant results for "${query}". Try rephrasing or being more specific.` };
      }
      return { success: true as const, results: results.join("\n\n") };
    } catch (err) {
      return { success: false as const, error: `Search failed: ${(err as Error).message}` };
    }
  },
});

export const webFetchTool = tool({
  description: "Fetch and read a web page's text content. HTML is stripped automatically. Use for: reading docs, API references, or specific URLs the user provides. Truncated at ~1500 tokens.",
  inputSchema: z.object({
    url: z.string().describe("URL to fetch"),
  }),
  execute: async ({ url }) => {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "terminal-agent/1.0" },
      });
      if (!res.ok) {
        return { success: false as const, error: `HTTP ${res.status} ${res.statusText}` };
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text") && !contentType.includes("json")) {
        return { success: false as const, error: `Non-text content: ${contentType}` };
      }
      let text = await res.text();
      // Strip HTML tags for readability
      text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
      text = text.replace(/<[^>]+>/g, " ");
      text = text.replace(/\s+/g, " ").trim();
      // Truncate to avoid massive context
      if (text.length > MAX_WEB_FETCH_CHARS) {
        text = text.slice(0, MAX_WEB_FETCH_CHARS) + "\n[truncated]";
      }
      return { success: true as const, content: text };
    } catch (err) {
      return { success: false as const, error: `Fetch failed: ${(err as Error).message}` };
    }
  },
});
