import { generateText } from "ai";
import type { ModelHandle } from "../ai/providers.js";

export async function buildArchitectPlan(options: {
  architectModel: ModelHandle;
  editorModel: ModelHandle;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }>;
  userText: string;
}): Promise<string | null> {
  const { architectModel, editorModel, systemPrompt, messages, userText } = options;
  if (architectModel.runtime !== "sdk" || !architectModel.model) return null;
  if (editorModel.runtime !== "sdk" || !editorModel.model) return null;

  const contextMessages = messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content,
  }));

  try {
    const result = await generateText({
      model: architectModel.model,
      system: `${systemPrompt}

You are the architect pass for a coding agent.
Return a short edit plan for the editor model.
Focus on exact files, likely tool order, validation commands, and constraints.
Do not answer the user directly.
Do not emit tool calls.
Keep it under 12 bullets.`,
      messages: [
        ...contextMessages,
        { role: "user", content: `User request:\n${userText}` },
      ],
      maxOutputTokens: 700,
    });
    const plan = result.text.trim();
    return plan || null;
  } catch {
    return null;
  }
}
