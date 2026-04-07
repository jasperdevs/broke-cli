import type { CavemanLevel } from "./config.js";

const FILLER_WORDS = /\b(just|really|basically|actually|simply|definitely|certainly|literally|quite|rather|very)\b/gi;
const ARTICLE_WORDS = /\b(a|an|the)\b/gi;
const HEDGING_PHRASES = [
  /\bit(?:'s| is) likely that\b/gi,
  /\bit(?:'s| is) possible that\b/gi,
  /\bit might be worth\b/gi,
  /\byou could consider\b/gi,
  /\bi think\b/gi,
  /\bi believe\b/gi,
  /\bprobably\b/gi,
  /\bperhaps\b/gi,
  /\bmaybe\b/gi,
];

const LEAD_IN_PHRASES = [
  /\bsure!?/gi,
  /\bcertainly!?/gi,
  /\bof course!?/gi,
  /\bhappy to help!?/gi,
  /\bi(?:'d| would) be happy to help(?: with that)?!?/gi,
  /\bi(?:'d| would) be happy to help you(?: with that)?!?/gi,
  /\bi(?:'d| would) be happy to help(?: you)?(?: with that)?!?/gi,
  /\blet me(?: go ahead and)?\b/gi,
  /\blet me know if\b[\s\S]*$/gi,
  /\bhope (?:that )?helps\b\.?/gi,
];

const VERBOSE_REWRITES: Array<[RegExp, string]> = [
  [/\bthe reason ([^.]+?) is because ([^.]+)\b/gi, "$1 bc $2"],
  [/\bthis is because\b/gi, "bc"],
  [/\bthe issue (?:you'?re experiencing )?is(?: most)? likely caused by\b/gi, "Cause:"],
  [/\bi(?:'d| would) recommend(?: that you)?(?: using)?\b/gi, "Use"],
  [/\byou can use\b/gi, "Use"],
  [/\bgo ahead and\b/gi, ""],
  [/\bin order to\b/gi, "to"],
  [/\bwhat you need to do is\b/gi, ""],
];

const ULTRA_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bconfiguration\b/gi, "cfg"],
  [/\bcontext\b/gi, "ctx"],
  [/\bproject\b/gi, "proj"],
  [/\bprovider\b/gi, "prov"],
  [/\bmessage\b/gi, "msg"],
  [/\bmessages\b/gi, "msgs"],
  [/\bfunction\b/gi, "fn"],
  [/\bfunctions\b/gi, "fns"],
  [/\bimplementation\b/gi, "impl"],
  [/\bimplement\b/gi, "impl"],
  [/\bdirectory\b/gi, "dir"],
  [/\bdirectories\b/gi, "dirs"],
  [/\bresponse\b/gi, "resp"],
  [/\brequest\b/gi, "req"],
  [/\bwithout\b/gi, "w/o"],
  [/\bbecause\b/gi, "bc"],
];

function protectInlineCode(segment: string): { text: string; restore: (value: string) => string } {
  const stash: string[] = [];
  const protectedMatchers = [
    /`[^`\n]+`/g,
    /\b(?:https?:\/\/|www\.)\S+\b/g,
    /\b[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8}\b/g,
  ];
  let text = segment;
  for (const matcher of protectedMatchers) {
    text = text.replace(matcher, (match) => {
      const token = `__CODE_${stash.length}__`;
      stash.push(match);
      return token;
    });
  }
  return {
    text,
    restore: (value: string) => value.replace(/__CODE_(\d+)__/g, (_, idx) => stash[Number(idx)] ?? ""),
  };
}

function cleanupWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +([,.;:!?])/g, "$1")
    .replace(/(^|\n)\s+/g, "$1")
    .trim();
}

function squeezeSentence(sentence: string, level: Exclude<CavemanLevel, "off" | "auto">): string {
  let next = sentence;

  for (const pattern of LEAD_IN_PHRASES) next = next.replace(pattern, "");
  for (const pattern of HEDGING_PHRASES) next = next.replace(pattern, "");
  for (const [pattern, replacement] of VERBOSE_REWRITES) next = next.replace(pattern, replacement);
  next = next.replace(FILLER_WORDS, "");
  next = next.replace(/\bplease\b/gi, "");

  if (level === "ultra") {
    next = next.replace(ARTICLE_WORDS, "");
    for (const [pattern, replacement] of ULTRA_ABBREVIATIONS) next = next.replace(pattern, replacement);
    next = next
      .replace(/\bI\b/g, "")
      .replace(/\bwe\b/gi, "")
      .replace(/\bcan\b/gi, "")
      .replace(/\bneed to\b/gi, "")
      .replace(/\byou\b/gi, "");
  }

  next = cleanupWhitespace(next);
  next = next.replace(/^[,.;:!? -]+/g, "").replace(/[ \t-]+$/g, "");
  return next;
}

function isProtectedLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^([`>#-]|\* |\d+\. )/.test(trimmed)) return true;
  if (/(^|[^\w])(npm|pnpm|yarn|git|node|npx|bun|cargo|go|python|pytest|tsc|vitest)\b/.test(trimmed)) return true;
  if (/^\w+[:=]/.test(trimmed) || /[{}()[\]<>]/.test(trimmed) && /`/.test(trimmed)) return true;
  return false;
}

function rewritePlainSegment(segment: string, level: Exclude<CavemanLevel, "off" | "auto">): string {
  if (!segment.trim()) return segment;
  const lines = segment.split("\n");
  const rewritten = lines.map((line) => {
    if (isProtectedLine(line)) return line;
    const protectedLine = protectInlineCode(line);
    const sentences = protectedLine.text
      .split(/(?<=[.!?])\s+/)
      .map((part) => squeezeSentence(part, level))
      .filter(Boolean);
    const joined = level === "ultra" && sentences.length > 0
      ? sentences.join(" ")
      : sentences.join(" ");
    return protectedLine.restore(joined);
  }).join("\n");
  return cleanupWhitespace(rewritten);
}

export function rewriteAssistantForCaveman(text: string, level: CavemanLevel): string {
  if (level === "off" || !text.trim()) return text.trim();
  const effectiveLevel: Exclude<CavemanLevel, "off" | "auto"> = level === "auto" ? "lite" : level;
  const parts = text.split(/(```[\s\S]*?```)/g);
  const rewritten = parts
    .map((part) => (part.startsWith("```") ? part : rewritePlainSegment(part, effectiveLevel)))
    .join("");
  return cleanupWhitespace(rewritten);
}

export function getCavemanPrompt(level: CavemanLevel): string {
  if (level === "lite") {
    return `<output-style>
CAVEMAN LITE ACTIVE.
- Drop filler, pleasantries, hedging. Keep grammar.
- Lead with answer. No warm-up paragraph.
- Keep technical terms exact. Code blocks unchanged. Error text quoted exact.
- Pattern: [thing] [action] [reason]. [next step].
- Good: "Bug in auth middleware. Token expiry check uses < not <=. Fix:"
</output-style>`;
  }

  if (level === "auto") {
    return `<output-style>
AUTO CAVEMAN ACTIVE.
- Pick compression per task.
- Trivial/docs/UI copy/chitchat: compress hard.
- Normal implementation/edit work: default to full caveman.
- Debug/security/research/review/explanation: keep more clarity, still no filler.
- Code blocks unchanged. Technical terms exact. Error text quoted exact.
- If user says hi/hey/thanks: answer in 1-4 clipped words max.
</output-style>`;
  }

  return `<output-style>
CAVEMAN ULTRA ACTIVE. Mouth small. Brain same.
- Drop articles, filler, pleasantries, hedging.
- Fragments fine. No need full sentence.
- Short words preferred. Abbrev where obvious: cfg/ctx/proj/prov/msg/req/resp/impl.
- Use verdict first. Then bug/file/fix/tests.
- Outside code: max 4 short lines unless user explicitly asks depth.
- Code blocks unchanged. Technical terms exact. Error text quoted exact.
- Pattern: [thing] [action] [reason]. [next step].
- Good: "Inline obj prop -> new ref -> re-render. Use \`useMemo\`."
- Bad: "I'd be happy to help. The reason this is happening is because..."
</output-style>`;
}
