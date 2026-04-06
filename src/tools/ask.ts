import { z } from "zod";
import { tool } from "ai";

/** Factory: creates an askUser tool bound to the app's question UI */
export function createAskUserTool(showQuestion: (question: string, options?: string[]) => Promise<string>) {
  return tool({
    description: "Ask the user a critical question that BLOCKS until answered. ONLY use for irreversible decisions (e.g. deleting files, overwriting work). NEVER use for clarification — just make reasonable assumptions and proceed. NEVER ask what the user wants — they already told you.",
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
