import type { ModelHandle } from "../ai/providers.js";
import { getPrettyModelName } from "../ai/model-catalog.js";
import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import { getSettings } from "../core/config.js";
import type { Session } from "../core/session.js";

export function buildBtwPrompt(question: string): string {
  return `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>

${question.trim()}`;
}

export function buildBtwMessages(
  session: Session,
  question: string,
): Array<{ role: "user" | "assistant"; content: string; images?: Array<{ mimeType: string; data: string }> }> {
  return [...session.getChatMessages(), { role: "user" as const, content: buildBtwPrompt(question) }];
}

export interface RunBtwQuestionOptions {
  session: Session;
  question: string;
  activeModel: ModelHandle;
  currentModelId: string;
  model: ModelHandle;
  modelId: string;
  systemPrompt: string;
  buildRuntimeSystemPrompt: (providerId?: string) => string;
  onUsage: (usage: { inputTokens: number; outputTokens: number; cost: number }) => void;
  app: {
    openBtwBubble: (bubble: { question: string; modelLabel: string; pending: boolean; abort: () => void }) => void;
    appendBtwBubble: (delta: string) => void;
    finishBtwBubble: (options?: { error?: string }) => void;
  };
}

export async function runBtwQuestion(options: RunBtwQuestionOptions): Promise<void> {
  const {
    session,
    question,
    activeModel,
    currentModelId,
    model,
    modelId,
    systemPrompt,
    buildRuntimeSystemPrompt,
    onUsage,
    app,
  } = options;

  const modelLabel = getPrettyModelName(modelId, model.provider.id);
  const abortController = new AbortController();
  const sideMessages = buildBtwMessages(session, question);
  const useDedicatedModel = model.provider.id !== activeModel.provider.id || modelId !== currentModelId;
  const sideSystemPrompt = useDedicatedModel ? buildRuntimeSystemPrompt(model.provider.id) : systemPrompt;
  const useThinking = getSettings().enableThinking;
  const thinkingLevel = getSettings().thinkingLevel || "low";

  app.openBtwBubble({
    question: question.trim(),
    modelLabel,
    pending: true,
    abort: () => abortController.abort(),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const onFinish = (usage: { inputTokens: number; outputTokens: number; cost: number }) => {
    onUsage(usage);
    app.finishBtwBubble();
  };

  const onError = (error: Error) => {
    if (error.name === "AbortError") return;
    app.finishBtwBubble({ error: error.message || "Failed to answer side question." });
  };

  if (model.runtime === "native-cli") {
    await startNativeStream({
      providerId: model.provider.id as "anthropic" | "codex",
      modelId,
      system: sideSystemPrompt,
      messages: sideMessages,
      abortSignal: abortController.signal,
      enableThinking: useThinking,
      thinkingLevel,
      cwd: process.cwd(),
      denyToolUse: true,
    }, {
      onText: (delta) => app.appendBtwBubble(delta),
      onReasoning: () => {},
      onFinish,
      onError,
    });
    return;
  }

  await startStream({
    model: model.model!,
    modelId,
    providerId: model.provider.id,
    system: sideSystemPrompt,
    messages: sideMessages,
    abortSignal: abortController.signal,
    enableThinking: useThinking,
    thinkingLevel,
  }, {
    onText: (delta) => app.appendBtwBubble(delta),
    onReasoning: () => {},
    onFinish,
    onError,
  });
}
