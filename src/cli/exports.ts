import { marked } from "marked";
import type { Session } from "../core/session.js";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

export function formatRelativeMinutes(updatedAt: number): string {
  const ago = Math.max(0, Math.floor((Date.now() - updatedAt) / 60000));
  if (ago < 1) return "now";
  if (ago < 60) return `${ago}m ago`;
  if (ago < 1440) return `${Math.floor(ago / 60)}h ago`;
  return `${Math.floor(ago / 1440)}d ago`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function buildMarkdownExport(
  msgs: ReturnType<Session["getMessages"]>,
  providerName: string,
  modelName: string,
  cwd: string,
): string {
  const header = [
    "# BrokeCLI Transcript",
    "",
    `- Exported: ${formatTimestamp(Date.now())}`,
    `- Model: ${providerName}/${modelName}`,
    `- Directory: \`${cwd}\``,
    "",
  ];
  const body = msgs.map((m) => {
    const title = m.role.charAt(0).toUpperCase() + m.role.slice(1);
    return `## ${title}\n\n_Time: ${formatTimestamp(m.timestamp)}_\n\n${m.content}\n`;
  });
  return [...header, ...body].join("\n");
}

export function buildHtmlExport(
  msgs: ReturnType<Session["getMessages"]>,
  providerName: string,
  modelName: string,
  cwd: string,
): string {
  const cards = msgs.map((m) => {
    const rendered = m.role === "assistant"
      ? marked.parse(m.content) as string
      : `<pre>${escapeHtml(m.content)}</pre>`;
    return `<article class="message ${m.role}">
<header>
  <span class="role">${escapeHtml(m.role)}</span>
  <time>${escapeHtml(formatTimestamp(m.timestamp))}</time>
</header>
<div class="content">${rendered}</div>
</article>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BrokeCLI Transcript</title>
</head>
<body>
<main class="shell">
  <section class="meta">
    <h1>BrokeCLI Transcript</h1>
    <div class="meta-row">Model: ${escapeHtml(providerName)}/${escapeHtml(modelName)}</div>
    <div class="meta-row">Directory: ${escapeHtml(cwd)}</div>
    <div class="meta-row">Exported: ${escapeHtml(formatTimestamp(Date.now()))}</div>
  </section>
  <section class="transcript">
    ${cards}
  </section>
</main>
</body>
</html>`;
}

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "chat";
}

export function buildShareFilePath(
  msgs: ReturnType<Session["getMessages"]>,
  cwd: string,
): string {
  const firstUser = msgs.find((msg) => msg.role === "user")?.content ?? "";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${slugifySegment(firstUser)}-${stamp}.html`;
  return join(homedir(), ".brokecli", "shares", slugifySegment(cwd.split(/[\\/]/).pop() ?? "project"), name);
}

export function toFileUrl(path: string): string {
  return `file:///${path.replace(/\\/g, "/")}`;
}

export async function publishTranscriptShare(options: {
  html: string;
  filePath: string;
  description: string;
}): Promise<
  | { kind: "gist"; url: string; id: string }
  | { kind: "local"; filePath: string; url: string }
> {
  const token = process.env.BROKECLI_SHARE_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    try {
      const response = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": "brokecli",
        },
        body: JSON.stringify({
          description: options.description,
          public: false,
          files: {
            "brokecli-transcript.html": {
              content: options.html,
            },
          },
        }),
      });
      if (response.ok) {
        const data = await response.json() as { id?: string; html_url?: string };
        if (data.id && data.html_url) {
          return { kind: "gist", id: data.id, url: data.html_url };
        }
      }
    } catch {
      // fall back to local share below
    }
  }

  mkdirSync(join(options.filePath, ".."), { recursive: true });
  writeFileSync(options.filePath, options.html, "utf-8");
  return { kind: "local", filePath: options.filePath, url: toFileUrl(options.filePath) };
}
