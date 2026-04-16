const MAX_READ_CHARS = 6000;
const MAX_LIST_FILES = 120;

export interface RemoteGitHubTarget {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  kind: "file" | "tree";
}

interface GitHubContentsEntry {
  name: string;
  type: string;
}

export function tryParseRemoteGitHubTarget(input: string): RemoteGitHubTarget | null {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "raw.githubusercontent.com" && parts.length >= 4) {
    const [owner, repo, ref, ...rest] = parts;
    return { owner, repo, ref, path: rest.join("/"), kind: "file" };
  }
  if (url.hostname !== "github.com" || parts.length < 2) return null;
  const [owner, repo, section, ref, ...rest] = parts;
  if (!owner || !repo) return null;
  if (section === "blob" && ref && rest.length > 0) {
    return { owner, repo, ref, path: rest.join("/"), kind: "file" };
  }
  if (section === "tree") {
    return { owner, repo, ref: ref || "HEAD", path: rest.join("/"), kind: "tree" };
  }
  return { owner, repo, ref: "HEAD", path: "", kind: "tree" };
}

export async function fetchRemoteGitHubFile(target: RemoteGitHubTarget) {
  const rawUrl = target.ref === "HEAD"
    ? `https://raw.githubusercontent.com/${target.owner}/${target.repo}/main/${target.path}`
    : `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.ref}/${target.path}`;
  const response = await fetch(rawUrl, {
    headers: {
      "user-agent": "terminal-agent",
      accept: "text/plain,*/*",
    },
  });
  if (!response.ok) {
    return { success: false as const, error: `Remote read failed (${response.status})` };
  }
  const raw = await response.text();
  let content = raw;
  if (content.length > MAX_READ_CHARS) {
    content = content.slice(0, MAX_READ_CHARS);
    return {
      success: true as const,
      content,
      totalLines: raw.split("\n").length,
      truncated: true,
      mode: "full" as const,
      remote: true,
      note: "Remote file truncated.",
      path: `${target.owner}/${target.repo}/${target.path}`,
    };
  }
  return {
    success: true as const,
    content,
    totalLines: raw.split("\n").length,
    mode: "full" as const,
    remote: true,
    path: `${target.owner}/${target.repo}/${target.path}`,
  };
}

export async function listRemoteGitHubTree(target: RemoteGitHubTarget) {
  const apiPath = target.path ? `/${target.path}` : "";
  const query = target.ref && target.ref !== "HEAD" ? `?ref=${encodeURIComponent(target.ref)}` : "";
  const response = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}/contents${apiPath}${query}`, {
    headers: {
      "user-agent": "terminal-agent",
      accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    return { success: false as const, error: `Remote list failed (${response.status})` };
  }
  const payload = await response.json();
  const items = (Array.isArray(payload) ? payload : [payload]) as GitHubContentsEntry[];
  const files = items
    .slice(0, MAX_LIST_FILES)
    .map((entry) => entry.type === "dir" ? `${entry.name}/` : entry.name);
  return {
    files,
    totalEntries: items.length,
    truncated: items.length > MAX_LIST_FILES,
    remote: true,
    path: `${target.owner}/${target.repo}${target.path ? `/${target.path}` : ""}`,
  };
}
