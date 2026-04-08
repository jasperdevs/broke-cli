import { generateText } from "ai";
import type { ModelHandle } from "../ai/providers.js";
import { getSettings } from "../core/config.js";
import type { Session } from "../core/session.js";
import { isDefaultSessionName } from "../core/session.js";

interface NamingApp {
  setSessionName?(name: string): void;
}

interface NamingSession {
  getName?(): string;
  setName?(name: string): void;
}

function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function normalizeTitleSource(text: string): string {
  return text
    .replace(/[^\w\s./!?-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clipPiStyleTitle(text: string): string {
  const cleaned = normalizeTitleSource(text);
  if (!cleaned) return "";
  const sentenceEnd = cleaned.search(/[.!?]/);
  if (sentenceEnd > 0 && sentenceEnd <= 50) return cleaned.substring(0, sentenceEnd + 1);
  return cleaned.length <= 50 ? cleaned : `${cleaned.substring(0, 47)}...`;
}

function isGreetingOnly(text: string): boolean {
  const cleaned = normalizeTitleSource(text).toLowerCase();
  if (!cleaned) return false;
  return /^(?:hi|hey|hello|yo|sup|test|thanks|thank you|help)(?:\s+\w+){0,2}[.!?]*$/.test(cleaned);
}

function deriveFallbackTitle(userText: string, assistantText: string): string {
  const primary = clipPiStyleTitle(userText);
  if (primary && !isGreetingOnly(primary)) return primary;
  return clipPiStyleTitle(assistantText) || primary;
}

async function generateTitleWithModel(model: ModelHandle, modelId: string, userText: string, assistantText: string): Promise<string | null> {
  if (model.runtime !== "sdk" || !model.model) return null;
  const result = await generateText({
    model: model.model,
    system: "Return a concise session title. Plain text only. Two to five words. No quotes. No trailing punctuation.",
    prompt: [
      `User: ${userText.trim()}`,
      `Assistant: ${assistantText.trim().slice(0, 240)}`,
      `Model: ${modelId}`,
    ].join("\n"),
    maxOutputTokens: 18,
  });
  const title = sanitizeTitle(result.text);
  return title || null;
}

export async function maybeAutoNameSession(options: {
  app: NamingApp;
  session: Session | NamingSession;
  userText: string;
  assistantText: string;
  smallModel: ModelHandle | null;
  smallModelId: string;
  activeModel: ModelHandle;
  currentModelId: string;
}): Promise<void> {
  const {
    app,
    session,
    userText,
    assistantText,
    smallModel,
    smallModelId,
    activeModel,
    currentModelId,
  } = options;
  if (typeof session.getName === "function" && !isDefaultSessionName(session.getName())) return;
  if (!userText.trim() || !assistantText.trim()) return;

  if (getSettings().modelGeneratedSessionNames === false) {
    const fallbackTitle = sanitizeTitle(deriveFallbackTitle(userText, assistantText));
    if (!fallbackTitle || isDefaultSessionName(fallbackTitle)) return;
    session.setName?.(fallbackTitle);
    app.setSessionName?.(fallbackTitle);
    return;
  }

  let nextTitle: string | null = null;
  try {
    if (smallModel && smallModelId) {
      nextTitle = await generateTitleWithModel(smallModel, smallModelId, userText, assistantText);
    }
    if (!nextTitle) {
      nextTitle = await generateTitleWithModel(activeModel, currentModelId, userText, assistantText);
    }
  } catch {
    nextTitle = null;
  }

  const finalTitle = sanitizeTitle(nextTitle ?? deriveFallbackTitle(userText, assistantText));
  if (!finalTitle || isDefaultSessionName(finalTitle)) return;
  session.setName?.(finalTitle);
  app.setSessionName?.(finalTitle);
}
