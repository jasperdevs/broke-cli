import type { QuestionRequest, QuestionResult } from "./app-types.js";
import { createQuestionView } from "./question-view.js";

type AppState = any;

export function showQuestionnaire(app: AppState, request: QuestionRequest): Promise<QuestionResult> {
  return new Promise((resolve) => {
    app.questionView = createQuestionView(request, resolve);
    app.drawNow();
  });
}

export async function showQuestion(app: AppState, question: string, options?: string[]): Promise<string> {
  const result = await showQuestionnaire(app, {
    title: "Question",
    submitLabel: "Submit",
    questions: [{
      id: "answer",
      label: "Answer",
      prompt: question,
      kind: options && options.length > 0 ? "single" : "text",
      options: (options ?? []).map((option) => ({ value: option, label: option })),
      required: true,
      allowOther: !!(options && options.length > 0),
    }],
  });
  if (result.cancelled) return "[user skipped]";
  const answer = result.answers[0];
  if (!answer) return "[no answer]";
  return Array.isArray(answer.value) ? answer.value.join(", ") : answer.value;
}
