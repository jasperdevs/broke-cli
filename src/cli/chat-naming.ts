import { generateText } from "ai";
import type { ModelHandle } from "../ai/providers.js";
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

function deriveFallbackTitle(userText: string): string {
  const cleaned = userText
    .replace(/[^\w\s./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 5);
  if (words.length === 0) return "";
  const titled = words.join(" ").replace(/\b\w/g, (char) => char.toUpperCase());
  return titled.slice(0, 48);
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

  const finalTitle = sanitizeTitle(nextTitle ?? deriveFallbackTitle(userText));
  if (!finalTitle || isDefaultSessionName(finalTitle)) return;
  session.setName?.(finalTitle);
  app.setSessionName?.(finalTitle);
}
