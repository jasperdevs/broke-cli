import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import type { Mode, CavemanLevel } from "./config.js";
import type { PromptProfile } from "./turn-policy.js";

const CONVENTION_FILES = [
  "CONVENTIONS.md",
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
];

const GLOBAL_CONTEXT_DIR = join(homedir(), ".brokecli");

/** Max tokens to spend on convention file contents */
const MAX_CONVENTION_CHARS = 3200; // ~800 tokens

let cachedPrompts = new Map<string, string>();

export function buildSystemPrompt(cwd: string, providerId?: string, mode?: Mode, cavemanLevel?: CavemanLevel, profile: PromptProfile = "full"): string {
  const cacheKey = `${providerId ?? "default"}:${mode ?? "build"}:${cavemanLevel ?? "off"}:${profile}:${cwd}`;
  const cached = cachedPrompts.get(cacheKey);
  if (cached) return cached;

  const parts: string[] = [];

  if (profile === "casual") {
    parts.push(`You are a fast, helpful assistant running in the user's terminal. Friendly, brief, direct.

<guidelines>
- This is a lightweight casual turn. Respond naturally and briefly.
- No tools for this turn.
- Do not drag in repo context, long explanations, or file details unless the user asks.
- Never expose raw tool calls, XML tags, JSON payloads, function-call syntax, or internal protocol text to the user.
- Keep it to a sentence or two unless the user asks for more.
</guidelines>`);
  } else {
    // Core identity + behavioral guidelines (blended Pi + OpenCode style)
    parts.push(`You are a fast, helpful coding assistant running in the user's terminal. You're friendly, sharp, and direct.

<guidelines>
- For casual messages (greetings, chitchat, questions about yourself), respond naturally and conversationally. No tools needed. You have personality — be warm but brief.
- Never refuse a benign user request just because it is not code. If the ask is writing, explanation, brainstorming, planning, or general help, answer it directly unless it is unsafe or disallowed.
- For coding tasks, use tools directly. Never just show code — write it to the file.
- If the task needs file changes or repo inspection, do tool calls first. No "first step" narration. No intent monologue.
- Do not describe which lane/plan/skill you are about to use in chat. Just do the work.
- Never expose raw tool calls, XML tags, JSON payloads, function-call syntax, or internal protocol text to the user.
- Never print pseudo-tool calls like writeFile(...), <tool_call>...</tool_call>, or call:writeFile{...} in chat.
- If tool execution is unavailable for a turn, do not fake it and do not dump a full file unless the user explicitly asked for the file contents. Explain the limit briefly instead.
- Be concise. Short sentences. No filler. 1-2 sentence explanations after changes.
- Read before editing. Always read a file before modifying it.
- Use editFile for targeted changes. Only use writeFile for new files or complete rewrites.
- Prefer semSearch for conceptual code discovery, grep for exact text, readFile for known files.
- Do not use bash for cat/find/head/tail/grep-style repo exploration when native tools can do it cheaper.
- Verify after changes when possible — run tests or the build to catch errors.
- Follow existing patterns. Match the project's style, naming, and conventions.
- Do not re-read files already in context.
- Only explore the project when the task requires it. Do NOT list files unprompted.
- If a task is ambiguous, make a reasonable assumption and proceed. Use askUser for real decisions (preferences, destructive confirmations, choosing between options).
</guidelines>`);
  }

  // Environment — minimal
  let isGit = false;
  try { execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" }); isGit = true; } catch {}

  parts.push(`<env>cwd: ${cwd} | git: ${isGit ? "yes" : "no"} | platform: ${process.platform}</env>`);

  // Per-tool guidelines — compact version when caveman is aggressive
  if (profile === "full" && cavemanLevel === "ultra") {
    parts.push(`<tool-tips>
bash: tests/builds/git/install. No cat/sed/grep. 30s timeout.
semSearch: natural-language code discovery. Use before broad grep on unfamiliar code.
readFile: offset/limit for large files. Max 500 lines.
editFile: EXACT match old_string. Enough context for uniqueness.
writeFile: New files only. readFile first if exists.
listFiles: Explore code. Depth 3.
grep: Exact strings/defs/usages. Use include glob.
askUser: Only for user decisions.
todoWrite: Task checklist for 3+ step work.
</tool-tips>`);
  } else if (profile === "full") {
    parts.push(`<tool-tips>
bash: Use for running tests, builds, git commands, installs, and real shell workflows. Prefer tools over bash for file operations and repo exploration (don't cat/find/head/tail/grep via bash). Commands timeout at 30s by default.
semSearch: Natural-language code discovery when you know behavior/intent but not exact filenames or symbols. Prefer this before broad grep on unfamiliar codebases.
readFile: Use offset/limit for large files — don't read entire files over 500 lines.
editFile: old_string must be an EXACT match of existing text. Include enough surrounding context to be unique. Prefer this over writeFile for changes.
writeFile: For new files or complete rewrites only. Always readFile first if the file exists.
listFiles: Start here when exploring unfamiliar code. Default depth is 3.
grep: For exact strings, definitions, usages, and regex patterns across the codebase. Use include glob to narrow search.
webSearch: For current docs, APIs, recent events. Not for things you already know.
webFetch: For reading specific URLs — docs pages, API references. Content is stripped of HTML.
askUser: Use when you need the user's preference or decision. Good for: "which color?", "option A or B?", "delete these files?". Not for: things you can figure out yourself.
todoWrite: Create or update a task checklist for multi-step work. Use at the start of complex tasks (3+ steps) to show your plan, then update status as you complete each step. Helps the user track progress.
</tool-tips>`);
  }

  // Global context files (truncated)
  if (profile === "full") {
    for (const file of ["AGENTS.md", "SYSTEM.md"]) {
      const path = join(GLOBAL_CONTEXT_DIR, file);
      if (existsSync(path)) {
        try {
          let content = readFileSync(path, "utf-8").trim();
          if (content) {
            if (content.length > MAX_CONVENTION_CHARS) {
              content = content.slice(0, MAX_CONVENTION_CHARS) + "\n[truncated]";
            }
            parts.push(`--- ${file} ---\n${content}`);
          }
        } catch { /* skip */ }
      }
    }

    // Walk up directory tree for convention files (truncated)
    const seen = new Set<string>();
    let dir = cwd;
    const home = homedir();
    while (dir !== dirname(dir) && dir !== home) {
      for (const file of CONVENTION_FILES) {
        const path = join(dir, file);
        if (!seen.has(file) && existsSync(path)) {
          try {
            let content = readFileSync(path, "utf-8").trim();
            if (content) {
              if (content.length > MAX_CONVENTION_CHARS) {
                content = content.slice(0, MAX_CONVENTION_CHARS) + "\n[truncated]";
              }
              parts.push(`--- ${file} ---\n${content}`);
              seen.add(file);
            }
          } catch { /* skip */ }
        }
      }
      dir = dirname(dir);
    }
  }

  // Caveman mode — reduce output tokens by constraining verbosity
  if (cavemanLevel && cavemanLevel !== "off") {
    parts.push(getCavemanPrompt(cavemanLevel));
  }

  // Mode — one line
  if (mode === "plan") {
    parts.push(`MODE: plan — read first, outline steps, wait for confirmation.`);
  } else {
    parts.push(`MODE: build — make changes directly with tools.`);
  }

  const prompt = parts.join("\n");
  cachedPrompts.set(cacheKey, prompt);
  return prompt;
}

export function reloadContext(): void {
  cachedPrompts.clear();
}

const AUTO_CAVEMAN_SAFE_PATTERNS = [
  /\b(readme|docs?|documentation|comment)\b/i,
  /\btypo|spelling|rename\b/i,
  /\bcss|padding|margin|spacing|color|copy|wording|label|placeholder\b/i,
  /\b(env|environment)\s+var/i,
];

const AUTO_CAVEMAN_ROUTINE_PATTERNS = [
  /\badd|update|change|implement|make|create|fix|patch\b/i,
  /\bflag|setting|option|command|stage|menu|picker|sidebar|input|export\b/i,
  /\brefactor|cleanup|polish|wrap|scroll|cursor|layout\b/i,
  /\bhtml|css|copy|label|text|prompt|footer|header|spacing|theme\b/i,
];

const AUTO_CAVEMAN_ULTRA_PATTERNS = [
  /\bdocs?|readme|comment|copy|wording|label|placeholder|tooltip|padding|margin|spacing|color|css\b/i,
  /\brename|tiny|small|quick|simple|minor|compact|shorter|trim|align\b/i,
];

const AUTO_CAVEMAN_DANGER_PATTERNS = [
  /\bsecurity|auth|permission|secret|credential|xss|csrf|injection|exploit|vuln/i,
  /\bdebug|investigat|root cause|repro|failing test|broken|doesn'?t work|why\b/i,
  /\bperformance|benchmark|latency|memory leak|leak|regression/i,
  /\barchitecture|design|migration|migrate|review|research|compare|tradeoff|analy[sz]e\b/i,
  /\bexplain|walk me through|how does\b/i,
];

const AUTO_CAVEMAN_CHATTER_PATTERNS = [
  /^(hi|hey|yo|sup|hello|hiya|howdy|hola)\b/i,
  /\bhow are you\b/i,
  /\bwhat'?s up\b/i,
  /\bok(?:ay)?\b/i,
  /\bthanks?\b/i,
  /\bthx\b/i,
  /\bcool\b/i,
  /\bfine\??\b/i,
];

export function resolveCavemanLevel(level: CavemanLevel, userMessage: string): CavemanLevel {
  if (level === "off" || !userMessage.trim()) return level;

  if (level !== "auto") return level;

  const msg = userMessage.trim();
  if (AUTO_CAVEMAN_DANGER_PATTERNS.some((pattern) => pattern.test(msg))) return "off";
  if (msg.length > 400) return "off";
  if (AUTO_CAVEMAN_CHATTER_PATTERNS.some((pattern) => pattern.test(msg)) && msg.length < 120) return "ultra";
  if (msg.length < 80 && !/[.?!].*[.?!]/.test(msg)) return "ultra";
  if (AUTO_CAVEMAN_SAFE_PATTERNS.some((pattern) => pattern.test(msg))) return "ultra";
  if (AUTO_CAVEMAN_ULTRA_PATTERNS.some((pattern) => pattern.test(msg))) return "ultra";
  if (AUTO_CAVEMAN_ROUTINE_PATTERNS.some((pattern) => pattern.test(msg)) && msg.length < 240) return "ultra";
  if (AUTO_CAVEMAN_ROUTINE_PATTERNS.some((pattern) => pattern.test(msg))) return "lite";
  if (/\bwhat|which|where|when|who\b/i.test(msg) && msg.length < 100) return "ultra";

  return "lite";
}

function getCavemanPrompt(level: CavemanLevel): string {
  if (level === "lite") {
    return `<output-style>
CONCISE MODE ACTIVE. You MUST follow these rules for ALL responses:
- No filler (just/really/basically/actually/simply)
- No pleasantries (Sure!/Certainly!/Of course!/Happy to!/Great question!)
- No hedging (it might be worth/you could consider/perhaps)
- Lead with the answer, not the reasoning
- One explanation sentence after changes, max
- Code blocks unchanged. Technical terms exact. Error messages quoted exact.

NOT: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
YES: "Bug in auth middleware. Token expiry check uses < not <=. Fix:"
</output-style>`;
  }
  if (level === "auto") {
    return `<output-style>
AUTO CAVEMAN MODE ACTIVE. Compression level chosen per task.
- Default: compress hard.
- Trivial/docs/UI-copy/style/chatty turns: compress hardest.
- Normal implementation/edit work: terse by default.
- Debug/security/research/review/explanation work: keep more clarity.
- Never waste tokens on greetings, filler, or recap.
- If user says hi/hey/how are you/thanks: answer in 1-4 clipped words max.
- Keep code blocks exact. Keep technical terms exact. Keep error text exact.
</output-style>`;
  }
  return `<output-style>
MAXIMUM COMPRESSION MODE. Caveman ultra. Target: ~90% fewer output tokens.
- Drop articles/filler/pleasantries/hedging/pronouns unless needed.
- Fragments preferred. No full prose unless ambiguity/risk forces it.
- Abbreviate hard: DB/auth/cfg/env/req/res/fn/impl/msg/err/ref/ctx/proj/prov.
- Use arrows for causality: X → Y. Use slashes for alternatives.
- One thought per line. Prefer bullets/fragments over paragraphs.
- One word when one word enough. "Fixed." > "I fixed issue."
- No action narration. No recap unless user asks.
- Outside code/commands: max 4 short lines unless user explicitly asks depth.
- Prefer noun/verb shards: "footer overlap fixed" not full sentence.
- Prefer exact file/action/test triples: "app.ts align bottom. test added. build pass."
- If user asks explanation: answer in shards, not essay.
- Good pattern: [thing] [action] [reason]. [next step].
- Strong preference: verdict first. Then file/bug/fix. Then tests.
- No warmth theater. No "happy to help". No "let me know". No "hope that helps".
- Casual chat: blunt/minimal. "What need?" / "Fine. What need done?" / "Yep."
- Questions: shortest useful form. "Need what?" > "What do you need help with?"
- Code blocks unchanged. Errors quoted exact.

NOT: "I've gone ahead and added the missing database configuration to your environment file."
YES: "Added db_host to .env."

NOT: "The reason your React component is re-rendering is likely because you're creating a new object reference on each render cycle."
YES: "Inline obj prop → new ref → re-render. useMemo."

NOT: "Done. I updated the file and ran the test suite successfully."
YES: "Updated file. Tests pass."

NOT: "Hi. What do you need help with in this workspace?"
YES: "What need?"

NOT: "Fine. What do you need done?"
YES: "Fine. What need done?"
</output-style>`;
}
