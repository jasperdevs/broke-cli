import { z } from "zod";
import { tool } from "ai";

/** Factory: creates an askUser tool bound to the app's question UI */
export function createAskUserTool(showQuestion: (question: string, options?: string[]) => Promise<string>) {
  return tool({
    description: "Ask the user a question and wait for their response. Use when you need user input to proceed: choosing between options, confirming destructive actions, or getting preferences (colors, names, styles). Do NOT use to ask what the task is — the user already told you. Do NOT use when you can make a reasonable assumption instead.",
    inputSchema: z.object({
      question: z.string().describe("Clear, concise question"),
      options: z.array(z.string()).optional().describe("Optional choices (e.g. ['Yes', 'No'] or ['red', 'blue', 'green'])"),
    }),
    execute: async ({ question, options }) => {
      const answer = await showQuestion(question, options);
      return { success: true as const, answer };
    },
  });
}
