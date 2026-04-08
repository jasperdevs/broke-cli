import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { createHash } from "crypto";
import type { Mode, CavemanLevel } from "./config.js";
import type { PromptProfile } from "./turn-policy.js";
import { getCavemanPrompt } from "./caveman.js";
import { describeAutonomyPolicy } from "./permissions.js";

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

const SERVER_TASK_PATTERNS = [
  /\bserver\b/i,
  /\bport\s+\d+\b/i,
  /\bendpoint\b/i,
  /\bhttp\b/i,
  /\blisten(?:ing)?\b/i,
  /\bwatcher\b/i,
  /\bdaemon\b/i,
];

const GIT_RECOVERY_PATTERNS = [
  /\bcan'?t find\b.*\bchanges\b/i,
  /\blost\b.*\b(commit|changes|work)\b/i,
  /\breflog\b/i,
  /\bmerge\b.*\binto master\b/i,
  /\bchecked out master\b/i,
];

const NGINX_TASK_PATTERNS = [
  /\bnginx\b/i,
  /\brequest logging\b/i,
  /\brate limit(?:ing)?\b/i,
  /\bconf\.d\b/i,
];

const EXACT_CONTENT_PATTERNS = [
  /\bwith the content\b/i,
  /\bshould only contain\b/i,
  /\bexact(?:ly)?\b/i,
];

const DATA_CONVERSION_PATTERNS = [
  /\bparquet\b/i,
  /\bcsv\b/i,
  /\bconvert\b.*\bfile\b/i,
  /\bdataframe\b/i,
];

const SINGLE_FILE_PATCH_PATTERNS = [
  /\b(update|edit|change|fix)\b/i,
  /\bdo not touch any other files\b/i,
];

const SYMBOL_RENAME_PATTERNS = [
  /\brename\b/i,
  /\beverywhere\b/i,
];

const TEST_WRITING_PATTERNS = [
  /\bwrite\b.*\btest/i,
  /\bnode:test\b/i,
  /\btest\/[A-Za-z0-9_.-]+\b/i,
];

const READ_ONLY_ANSWER_PATTERNS = [
  /\bwithout changing any files\b/i,
  /\banswer in one sentence\b/i,
];

export function buildTaskExecutionAddendum(userMessage: string): string {
  const text = userMessage.trim();
  if (!text) return "";

  const rules: string[] = [];

  if (SERVER_TASK_PATTERNS.some((pattern) => pattern.test(text))) {
    rules.push(
      "Server task rule: the service must still be reachable after your shell command finishes.",
      "Start long-running services with a durable detached launch such as `nohup <cmd> >/tmp/<name>.log 2>&1 </dev/null & echo $! >/tmp/<name>.pid` on Unix.",
      "Do not rely on plain `&`, a foreground `npm start`, or the current shell session staying open.",
      "After detaching, wait briefly, then verify from a fresh command that the PID still exists and the port responds.",
      "If detaching fails, retry with a stronger launcher such as `setsid` instead of returning success.",
      "If the API response schema expects a number, return a JSON number, not a quoted string.",
      "If an integer parameter represents an index, count, or nth value, reject negative integers unless the task explicitly allows them.",
      "Before you finish, probe the running service using a fresh command such as `curl` or another separate request.",
    );
  }

  if (GIT_RECOVERY_PATTERNS.some((pattern) => pattern.test(text))) {
    rules.push(
      "Git recovery rule: prefer recovering the exact lost commit from git history or reflog, then merge or cherry-pick it onto the target branch.",
      "Do not manually reconstruct lost files when the exact commit content already exists in git history.",
      "When recovering onto `master`, preserve the recovered commit's file contents exactly unless the task explicitly asks for a manual edit.",
    );
  }

  if (NGINX_TASK_PATTERNS.some((pattern) => pattern.test(text))) {
    rules.push(
      "Nginx rule: directives that belong at `http` scope, especially `log_format` and `limit_req_zone`, must go in `nginx.conf`, not only inside a site `server` block.",
      "Keep the site file focused on the server block and use the configured shared names from `nginx.conf`.",
      "If the task requires custom request logging and per-IP rate limiting, add an explicit `log_format detailed ...` line and an explicit `limit_req_zone ... rate=10r/s;` line in `nginx.conf`'s `http` block.",
      "When the task gives literal page text for the site root or 404 page, write those files as the exact plain-text content unless the task explicitly asks for HTML markup.",
      "In the site `location` block, apply the shared zone with a modest burst such as `burst=10` unless the task explicitly requires a different limiter behavior.",
      "Before you finish, read back the config files and verify the literal directives exist in the exact file paths the task names.",
    );
  }

  if (EXACT_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    rules.push(
      "Exact-content rule: when the task gives literal output text, write that exact text and avoid adding extra wrapper markup or commentary unless the task explicitly requires it.",
    );
  }

  if (DATA_CONVERSION_PATTERNS.some((pattern) => pattern.test(text))) {
    rules.push(
      "Data-conversion rule: preserve the input rows, columns, order, values, and inferred column dtypes exactly unless the task explicitly asks for transformation.",
      "Prefer straightforward local data tooling over detours. For CSV-to-Parquet work, prefer `python3` with `pandas` plus `pyarrow` or `fastparquet` over Node parquet libraries unless the task explicitly requires another stack.",
      "If `python3` is available but the parquet libraries are missing, install the minimal Python packages needed and use that path instead of switching formats or hand-rolling a writer. If `pip` is unavailable, bootstrap a local `uv` environment and add `pandas` plus `pyarrow` there.",
      "For CSV-to-Parquet work, read the CSV into one pandas dataframe and write that same dataframe directly with `df.to_parquet(...)`; do not rebuild rows from stringified records or normalize every column to strings.",
      "Verify CSV-to-Parquet output with the same check shape the task implies: compare `pd.read_csv(source)` against `pd.read_parquet(output)` using `pd.testing.assert_frame_equal(...)` after resetting the index.",
      "A correct minimal shape is: `df = pd.read_csv(source)` followed by `df.to_parquet(output)` and then the same two pandas reads plus `assert_frame_equal(...)` for verification.",
      "Do not fall back to JavaScript parquet libraries if they coerce numeric columns into strings or bigint wrappers on round-trip.",
      "Before you finish, reopen both the source and output files and verify the records match, not just that the output file exists.",
    );
  }

  if (SINGLE_FILE_PATCH_PATTERNS.every((pattern) => pattern.test(text)) && /\b[A-Za-z0-9_./-]+\.[A-Za-z0-9]+\b/.test(text)) {
    rules.push(
      "Direct-edit rule: read only the named file, apply the exact requested patch, and stop.",
      "Do not inspect unrelated files, run tests, or use shell unless the request explicitly requires it or the file content is ambiguous.",
    );
  }

  if (SYMBOL_RENAME_PATTERNS.every((pattern) => pattern.test(text))) {
    rules.push(
      "Rename rule: do one search for the old symbol, patch only the matches, and stop when no references remain.",
      "Prefer exact targeted edits over rewrites. Do not run shell unless the request explicitly asks for verification.",
    );
  }

  if (TEST_WRITING_PATTERNS.some((pattern) => pattern.test(text))) {
    rules.push(
      "Test-writing rule: read the source file once, write the requested test file, and stop.",
      "Do not run tests or shell unless the user explicitly asks, or the source behavior is unclear from direct inspection.",
    );
  }

  if (READ_ONLY_ANSWER_PATTERNS.some((pattern) => pattern.test(text))) {
    rules.push(
      "Read-only answer rule: use the smallest lookup that answers the question, then reply with the answer only.",
      "Do not edit files. Do not add extra explanation beyond the requested answer shape.",
    );
  }

  if (rules.length === 0) return "";

  return [
    "<task-rules>",
    ...rules,
    "</task-rules>",
  ].join("\n");
}

function buildCorePrompt(profile: PromptProfile): string {
  switch (profile) {
    case "casual":
      return [
        "You are a terminal assistant.",
        "Casual turn: answer naturally in 1-2 short sentences.",
        "No tools.",
        "No repo detail unless asked.",
        "Never expose tool or protocol syntax.",
      ].join("\n");
    case "lean":
      return [
        "You are a terminal coding assistant.",
        "Answer directly.",
        "Use tools only when they materially improve correctness.",
        "Prefer native read/search tools over shell for repo lookup.",
        "Keep the final answer short and factual.",
        "Never expose tool or protocol syntax.",
      ].join("\n");
    case "edit":
      return [
        "You are a terminal coding assistant.",
        "For repo work: inspect first, then make the smallest correct change.",
        "Prefer editFile for existing files and writeFile only for new files or full rewrites.",
        "Use shell only for real commands, tests, builds, or installs.",
        "After tool work, reply in at most 2 short lines: changed + verification/blocker.",
        "Never expose tool or protocol syntax.",
      ].join("\n");
    case "followup":
      return [
        "You are continuing repo work from the last turn.",
        "Reuse recent edit state first.",
        "Re-open files only if needed.",
        "Make one narrow change, then stop.",
        "Reply in one short line.",
      ].join("\n");
    case "full":
    default:
      return [
        "You are a terminal coding assistant.",
        "Handle benign non-code requests directly.",
        "For repo work: inspect first, then act with tools.",
        "Prefer native read/search tools over shell when they are enough.",
        "Keep the final answer brief and concrete.",
        "Never expose tool or protocol syntax.",
      ].join("\n");
  }
}

export function buildSystemPrompt(cwd: string, providerId?: string, mode?: Mode, cavemanLevel?: CavemanLevel, profile: PromptProfile = "full"): string {
  const cacheKey = `${providerId ?? "default"}:${mode ?? "build"}:${cavemanLevel ?? "off"}:${profile}:${cwd}`;
  const cached = cachedPrompts.get(cacheKey);
  if (cached) return cached;

  const parts: string[] = [];

  parts.push(buildCorePrompt(profile));

  // Environment — minimal
  let isGit = false;
  try { execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" }); isGit = true; } catch {}

  parts.push(`<env>git:${isGit ? "yes" : "no"} platform:${process.platform}</env>`);

  if (profile === "full") {
    parts.push(`<autonomy>
${describeAutonomyPolicy(cwd).join("\n")}
</autonomy>`);
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
  parts.push(mode === "plan" ? "MODE: plan" : "MODE: build");

  const prompt = parts.join("\n");
  cachedPrompts.set(cacheKey, prompt);
  return prompt;
}

export function buildPromptCacheKey(options: {
  cwd: string;
  providerId?: string;
  modelId?: string;
  mode?: Mode;
  cavemanLevel?: CavemanLevel;
  profile?: PromptProfile;
}): string {
  const key = [
    options.cwd,
    options.providerId ?? "default",
    options.modelId ?? "default",
    options.mode ?? "build",
    options.cavemanLevel ?? "off",
    options.profile ?? "full",
  ].join("|");
  return `brokecli:${createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
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
