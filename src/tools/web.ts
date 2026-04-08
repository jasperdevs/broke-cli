import { z } from "zod";
import { tool } from "ai";
import { ensureNetworkAllowed } from "../core/permissions.js";

const MAX_WEB_FETCH_CHARS = 6000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 25_000;
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

function getFetchHeaders(format: "text" | "markdown" | "html"): Record<string, string> {
  let accept = "*/*";
  if (format === "markdown") {
    accept = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
  } else if (format === "text") {
    accept = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
  } else if (format === "html") {
    accept = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1";
  }

  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
  };
}

function truncateText(content: string, maxChars = MAX_WEB_FETCH_CHARS): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  return { content: `${content.slice(0, maxChars)}\n[truncated]`, truncated: true };
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<\/(p|div|section|article|main|header|footer|li|ul|ol|table|tr|h[1-6]|pre|code)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function htmlToMarkdown(html: string): string {
  return stripHtmlToText(
    html
      .replace(/<a [^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (_match, href: string, label: string) => `${stripHtmlToText(label)} (${href})`)
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n")
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
      .replace(/<li[^>]*>(.*?)<\/li>/gi, "\n- $1")
      .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n"),
  );
}

async function fetchResponseWithRetry(url: string, format: "text" | "markdown" | "html", timeoutMs: number): Promise<Response> {
  const controller = AbortSignal.timeout(timeoutMs);
  const headers = getFetchHeaders(format);
  const initial = await fetch(url, { signal: controller, headers });
  if (initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge") {
    return fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...headers, "User-Agent": "brokecli" },
    });
  }
  return initial;
}

async function decodeResponse(response: Response): Promise<{ text: string; contentType: string }> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("Response too large (exceeds 5MB limit)");
  }
  let text = "";
  if (typeof response.arrayBuffer === "function") {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("Response too large (exceeds 5MB limit)");
    }
    text = new TextDecoder().decode(arrayBuffer);
  } else {
    text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error("Response too large (exceeds 5MB limit)");
    }
  }
  return {
    text,
    contentType: response.headers.get("content-type") ?? "",
  };
}

async function searchViaExa(query: string, numResults: number): Promise<string | null> {
  const requestBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "web_search_exa",
      arguments: {
        query,
        type: "auto",
        numResults,
        livecrawl: "fallback",
        contextMaxCharacters: 10_000,
      },
    },
  };

  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(DEFAULT_SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Search error (${response.status})`);
  }

  const body = await response.text();
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = JSON.parse(line.slice(6)) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const text = payload.result?.content?.[0]?.text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return null;
}

async function searchViaDuckDuckGo(query: string): Promise<string> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: getFetchHeaders("html"),
    signal: AbortSignal.timeout(DEFAULT_SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Fallback search failed (${response.status})`);
  }
  const html = await response.text();
  const results = [...html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .slice(0, 6)
    .map((match) => {
      const url = match[1];
      const title = stripHtmlToText(match[2]);
      return title && url ? `${title}\n${url}` : "";
    })
    .filter(Boolean);

  if (results.length === 0) {
    return `No search results for "${query}".`;
  }

  return results.join("\n\n");
}

export const webSearchTool = tool({
  description: "Search the web for current documentation, APIs, and recent information. Uses a real search backend first and falls back to HTML search result parsing if needed.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    numResults: z.number().optional().describe("Maximum number of results to request"),
  }),
  execute: async ({ query, numResults }) => {
    const network = ensureNetworkAllowed();
    if (!network.allowed) {
      return { success: false as const, error: network.reason };
    }

    try {
      const primary = await searchViaExa(query, Math.min(Math.max(numResults ?? 8, 1), 10));
      if (primary) return { success: true as const, results: primary, backend: "exa" as const };
    } catch {
      // Fall back to HTML search parsing below.
    }

    try {
      const fallback = await searchViaDuckDuckGo(query);
      return { success: true as const, results: fallback, backend: "duckduckgo-html" as const };
    } catch (err) {
      return { success: false as const, error: `Search failed: ${(err as Error).message}` };
    }
  },
});

export const webFetchTool = tool({
  description: "Fetch and read a specific URL with size limits, timeout control, and better HTML handling. Supports text, markdown, or raw html output.",
  inputSchema: z.object({
    url: z.string().describe("URL to fetch"),
    format: z.enum(["text", "markdown", "html"]).default("markdown").describe("Return format"),
    timeout: z.number().optional().describe("Timeout in seconds (max 120)"),
  }),
  execute: async ({ url, format, timeout }) => {
    const network = ensureNetworkAllowed();
    if (!network.allowed) {
      return { success: false as const, error: network.reason };
    }
    if (!/^https?:\/\//i.test(url)) {
      return { success: false as const, error: "URL must start with http:// or https://" };
    }

    try {
      const timeoutMs = Math.min(Math.max((timeout ?? DEFAULT_FETCH_TIMEOUT_MS / 1000) * 1000, 1_000), 120_000);
      const response = await fetchResponseWithRetry(url, format, timeoutMs);
      if (!response.ok) {
        return { success: false as const, error: `HTTP ${response.status} ${response.statusText}` };
      }

      const { text, contentType } = await decodeResponse(response);
      const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
      if (mime.startsWith("image/") && mime !== "image/svg+xml") {
        return { success: false as const, error: `Non-text content: ${contentType}` };
      }

      let content = text;
      if (format === "markdown" && mime.includes("html")) {
        content = htmlToMarkdown(text);
      } else if (format === "text" && mime.includes("html")) {
        content = stripHtmlToText(text);
      }

      const truncated = truncateText(content);
      return {
        success: true as const,
        content: truncated.content,
        truncated: truncated.truncated,
        contentType,
        title: `${url} (${contentType || "unknown"})`,
      };
    } catch (err) {
      const error = err as Error;
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        return { success: false as const, error: "Fetch request timed out" };
      }
      return { success: false as const, error: `Fetch failed: ${error.message}` };
    }
  },
});
