import type { RgbColor } from "./render/mascot.js";
import type { BudgetReport } from "../core/budget-insights.js";
import type { InputWidget } from "./input.js";

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
  reports: {
    all: BudgetReport;
    session: BudgetReport;
  };
  scope: "all" | "session";
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

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionField {
  id: string;
  label: string;
  prompt: string;
  kind: "single" | "multi" | "text";
  options: QuestionOption[];
  required: boolean;
  allowOther?: boolean;
  placeholder?: string;
  maxSelections?: number;
}

export interface QuestionRequest {
  title: string;
  submitLabel: string;
  questions: QuestionField[];
}

export interface QuestionAnswer {
  id: string;
  kind: QuestionField["kind"];
  value: string | string[];
  label: string | string[];
  custom?: boolean;
}

export interface QuestionResult {
  cancelled: boolean;
  answers: QuestionAnswer[];
}

export interface QuestionView {
  title: string;
  submitLabel: string;
  questions: QuestionField[];
  activeIndex: number;
  optionCursor: number;
  answers: Record<string, QuestionAnswer>;
  editor: InputWidget;
  resolve: (result: QuestionResult) => void;
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
export type MascotGrid = Array<Array<RgbColor | null>>;
