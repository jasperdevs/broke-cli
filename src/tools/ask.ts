import { z } from "zod";
import { tool } from "ai";
import type { QuestionRequest, QuestionResult } from "../tui/app-types.js";

/** Factory: creates an askUser tool bound to the app's question UI */
export function createAskUserTool(showQuestionnaire: (request: QuestionRequest) => Promise<QuestionResult>) {
  const questionOptionSchema = z.object({
    value: z.string().min(1).max(120),
    label: z.string().min(1).max(120),
    description: z.string().max(240).optional(),
  });

  const questionFieldSchema = z.object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(40).optional(),
    prompt: z.string().min(1).max(240),
    kind: z.enum(["single", "multi", "text"]).default("single"),
    options: z.array(questionOptionSchema).max(8).default([]),
    required: z.boolean().default(true),
    placeholder: z.string().max(120).optional(),
    maxSelections: z.number().int().min(1).max(8).optional(),
  }).superRefine((field, ctx) => {
    if (field.kind !== "text" && field.options.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "choice questions require options" });
    }
    if (field.kind === "text" && field.options.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "text questions cannot include options" });
    }
  });

  return tool({
    description: "Ask the user a bounded interactive question or form and wait for their response. Use for real user decisions only: preferences, confirmations, missing values, or choosing between options. Supports single-choice, multi-choice, and text fields. Keep it short. Do NOT use arbitrary UI schemas or ask what the task is.",
    inputSchema: z.object({
      title: z.string().min(1).max(60).optional().describe("Short title shown in the question view"),
      question: z.string().min(1).max(240).optional().describe("Legacy single-question prompt"),
      options: z.array(z.string().min(1).max(120)).max(8).optional().describe("Legacy single-question choices"),
      questions: z.array(questionFieldSchema).max(6).optional().describe("Structured question list for forms"),
      submitLabel: z.string().min(1).max(24).optional().describe("Label for the submit action"),
    }).superRefine((input, ctx) => {
      const hasLegacy = !!input.question;
      const hasStructured = Array.isArray(input.questions) && input.questions.length > 0;
      if (!hasLegacy && !hasStructured) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "provide question or questions" });
      }
      if (hasLegacy && hasStructured) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "use either question/options or questions" });
      }
      if (!hasLegacy && input.options?.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "options require question" });
      }
    }),
    execute: async ({ title, question, options, questions, submitLabel }) => {
      const request: QuestionRequest = questions?.length
        ? {
            title: title ?? "Questionnaire",
            submitLabel: submitLabel ?? "Submit",
            questions: questions.map((field) => ({
              ...field,
              label: field.label ?? field.id,
            })),
          }
        : {
            title: title ?? "Question",
            submitLabel: submitLabel ?? "Submit",
            questions: [{
              id: "answer",
              label: "Answer",
              prompt: question!,
              kind: options?.length ? "single" : "text",
              options: (options ?? []).map((option) => ({ value: option, label: option })),
              required: true,
            }],
          };
      const result = await showQuestionnaire(request);
      const answers = Object.fromEntries(result.answers.map((answer) => [answer.id, answer.value]));
      const firstAnswer = result.answers[0];
      return {
        success: !result.cancelled,
        cancelled: result.cancelled,
        answer: firstAnswer ? firstAnswer.value : "[user skipped]",
        answers,
      };
    },
  });
}
