import { existsSync } from "fs";
import { join } from "path";
import type { TurnPolicy } from "./turn-policy.js";
import type { ToolName } from "../tools/registry.js";

export type SimpleFileTaskKind = "read" | "create" | "edit";

export interface SimpleFileTask {
  kind: SimpleFileTaskKind;
  path: string;
  existing: boolean;
  completeWithRead: boolean;
  preRead: boolean;
  requiredTool: ToolName;
}

const EXTENSIONS = ["html", "css", "js", "ts", "tsx", "jsx", "json", "md", "txt"];
const BARE_LIBRARY_REFERENCES = new Set(["three.js", "react.js", "vue.js", "node.js", "d3.js", "p5.js", "babylon.js", "phaser.js", "pixi.js", "matter.js"]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function looksLikeLibraryReference(text: string, index: number, candidate: string): boolean {
  if (/[\\/]/.test(candidate) || candidate.startsWith(".")) return false;
  if (!/\.(?:js|ts|jsx|tsx)$/i.test(candidate)) return false;
  const lower = candidate.toLowerCase();
  if (BARE_LIBRARY_REFERENCES.has(lower)) return true;
  if (/^[A-Z][A-Za-z0-9_-]*\.(?:js|ts|jsx|tsx)$/.test(candidate)) return true;
  const prefix = text.slice(Math.max(0, index - 24), index).toLowerCase();
  return /\b(?:in|with|using|via|for)\s+$/.test(prefix);
}

function explicitPath(text: string): string | null {
  const matcher = /\b[A-Za-z0-9_./-]+\.(?:html|css|js|ts|tsx|jsx|json|md|txt)\b/ig;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const candidate = match[0]!;
    if (looksLikeLibraryReference(text, match.index, candidate)) continue;
    return normalizePath(candidate);
  }
  return null;
}

function inferredPath(text: string, cwd: string): string | null {
  if (/\bindex\b/i.test(text) && existsSync(join(cwd, "index.html"))) return "index.html";
  if (/\breadme\b/i.test(text) && existsSync(join(cwd, "README.md"))) return "README.md";
  if (/\bpackage\b/i.test(text) && existsSync(join(cwd, "package.json"))) return "package.json";
  return null;
}

function isBareRead(text: string, path: string): boolean {
  const stripped = text
    .replace(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "")
    .replace(/\b(read|show|open|view|cat|file|this|the|please|contents?|of)\b/ig, "")
    .replace(/[^\w]+/g, "")
    .trim();
  return stripped.length === 0;
}

function hasReadIntent(text: string): boolean {
  return /^(?:please\s+)?(?:read|show|open|view|cat)\b/i.test(text);
}

function hasCreateIntent(text: string): boolean {
  return /\b(create|new file|write|make|generate|scaffold|add)\b/i.test(text)
    && (/\bfile\b/i.test(text) || !!explicitPath(text));
}

function hasEditIntent(text: string): boolean {
  return /\b(edit|change|update|fix|patch|modify|improve|better|make)\b/i.test(text);
}

function hasMultipleActionIntent(text: string): boolean {
  return /(?:,|\b(?:and|then|also)\b).*\b(?:add|write|create|run|test|verify|check|fix|edit|change|update)\b/i.test(text);
}

function toolFor(kind: SimpleFileTaskKind, existing: boolean): ToolName {
  if (kind === "read") return "readFile";
  if (kind === "create" && !existing) return "writeFile";
  return "editFile";
}

export function detectSimpleFileTask(text: string, cwd = process.cwd()): SimpleFileTask | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || /\b(plan|review|audit|explain|why|how does|walk me through|compare|research)\b/i.test(normalized)) {
    return null;
  }
  if (hasMultipleActionIntent(normalized)) return null;
  const path = explicitPath(normalized) ?? inferredPath(normalized, cwd);
  if (!path) return null;
  const existing = existsSync(join(cwd, path)) || existsSync(path);

  let kind: SimpleFileTaskKind | null = null;
  if (hasReadIntent(normalized)) kind = "read";
  else if (hasCreateIntent(normalized) && !existing) kind = "create";
  else if (hasEditIntent(normalized) || (hasCreateIntent(normalized) && existing)) kind = existing ? "edit" : "create";
  if (!kind) return null;

  const completeWithRead = kind === "read" && isBareRead(normalized, path);
  const preRead = existing && (kind === "edit" || (kind === "read" && !completeWithRead));
  const requiredTool = toolFor(kind, existing);
  return { kind, path, existing, completeWithRead, preRead, requiredTool };
}

export function applySimpleFileTaskPolicy(policy: TurnPolicy, task: SimpleFileTask | null): TurnPolicy {
  if (!task || task.completeWithRead) return policy;
  const allowedTools: ToolName[] = task.preRead
    ? [task.requiredTool]
    : [task.requiredTool];
  return {
    ...policy,
    archetype: task.kind === "read" ? "explore" : policy.archetype,
    allowedTools,
    maxToolSteps: 1,
    scaffold: [
      "lane: simple-file-action",
      `target: ${task.path}`,
      `steps: use ${task.requiredTool} exactly once, then stop`,
      "rules: no planning prose; no intent narration; no markdown essay; no alternate files",
      "verify: rely on tool result",
    ].join("\n"),
    preferSmallExecutor: task.kind === "read",
    promptProfile: task.kind === "read" ? "lean" : "edit",
    historyWindow: task.preRead ? 1 : policy.historyWindow,
  };
}

export function buildSimpleFileTaskPromptBlock(task: SimpleFileTask): string {
  const action = task.kind === "read"
    ? "read the target"
    : task.requiredTool === "writeFile"
      ? "write the target"
      : "edit the already-read target";
  return [
    "<simple-file-task>",
    `target: ${task.path}`,
    `runtime_lane: ${task.kind}`,
    `next_action: ${action}`,
    `required_tool: ${task.requiredTool}`,
    "visible_output_contract: no planning paragraph; emit the tool call; final answer <= 80 chars",
    "tool_contract:",
    "- readFile args: {\"path\":\"target\"}",
    "- writeFile args: {\"path\":\"target\",\"content\":\"complete file content\"}",
    "- editFile args: {\"path\":\"target\",\"edits\":[{\"oldText\":\"exact unique text from read context\",\"newText\":\"replacement\"}]}",
    "</simple-file-task>",
  ].join("\n");
}

export function extractKnownFileTargets(text: string, cwd = process.cwd()): string[] {
  const explicit = explicitPath(text);
  if (explicit) return [explicit];
  const inferred = inferredPath(text, cwd);
  return inferred ? [inferred] : [];
}
