import { z } from "zod";
import { tool } from "ai";

/** Factory: creates an askUser tool bound to the app's question UI */
export function createAskUserTool(showQuestion: (question: string, options?: string[]) => Promise<string>) {
  return tool({
    description: "Ask the user a question and wait for their response. Use this when you need clarification, confirmation, or input from the user before proceeding. For yes/no or multiple choice, provide options. For open-ended questions, omit options.",
    inputSchema: z.object({
      question: z.string().describe("The question to ask the user"),
      options: z.array(z.string()).optional().describe("Optional list of choices (e.g. ['Yes', 'No'] or ['Option A', 'Option B', 'Option C'])"),
    }),
    execute: async ({ question, options }) => {
      const answer = await showQuestion(question, options);
      return { success: true as const, answer };
    },
  });
}
