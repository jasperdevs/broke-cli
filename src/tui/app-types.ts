import type { RgbColor } from "./render/mascot.js";
import type { BudgetReport } from "../core/budget-insights.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  images?: Array<{ mimeType: string; data: string }>;
}

export interface ModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  active: boolean;
  isHeader?: boolean;
}

export interface SettingEntry {
  key: string;
  label: string;
  value: string;
  description: string;
}

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
}

export interface BudgetView {
  title: string;
  report: BudgetReport;
  scrollOffset: number;
}

export interface AgentRun {
  id: string;
  prompt: string;
  status: "running" | "done" | "error";
  result?: string;
  detail?: string;
  createdAt: number;
}

export interface AgentRunView {
  title: string;
  runs: AgentRun[];
  selectedIndex: number;
  scrollOffset: number;
}

export type PendingDelivery = "steering" | "followup";

export type MenuPromptKind =
  | "model"
  | "settings"
  | "permissions"
  | "extensions"
  | "theme"
  | "export"
  | "resume"
  | "session"
  | "hotkeys"
  | "tree"
  | "agents"
  | "projects"
  | "logout";

export interface MenuEntry {
  text: string;
  selectIndex?: number;
}

export type PendingImage = { mimeType: string; data: string };
export type PendingMessage = { text: string; images?: PendingImage[]; delivery: PendingDelivery };
export type TodoItem = { id: string; text: string; status: "pending" | "in_progress" | "done" };
export type QuestionPrompt = { question: string; options?: string[]; cursor: number; textInput: string; resolve: (answer: string) => void };
export type MascotGrid = Array<Array<RgbColor | null>>;
