import { z } from "zod";
import { tool } from "ai";

/** In-memory task list — persists across tool calls within a session */
export interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "done";
}

let todoItems: TodoItem[] = [];

/** Callback to notify UI when tasks change */
let onTodoChange: ((items: TodoItem[]) => void) | null = null;

export function setTodoChangeCallback(cb: ((items: TodoItem[]) => void) | null): void {
  onTodoChange = cb;
}

export function getTodoItems(): TodoItem[] {
  return [...todoItems];
}

export function clearTodo(): void {
  todoItems = [];
  onTodoChange?.(todoItems);
}

export const todoWriteTool = tool({
  description: "Create or update a task checklist to track progress on multi-step work. Use this at the start of complex tasks to show the user your plan, then update items as you complete them. Each call replaces the full list.",
  inputSchema: z.object({
    tasks: z.array(z.object({
      id: z.string().describe("Short unique id (e.g. 'setup', 'impl', 'test')"),
      text: z.string().describe("Task description"),
      status: z.enum(["pending", "in_progress", "done"]).describe("pending = not started, in_progress = working on it, done = completed"),
    })).describe("Full task list — replaces previous list"),
  }),
  execute: async ({ tasks }) => {
    todoItems = tasks.map(t => ({
      id: t.id,
      text: t.text,
      status: t.status,
    }));
    onTodoChange?.(todoItems);
    return { success: true as const, count: todoItems.length };
  },
});
