import type { RgbColor } from "./render/mascot.js";
import type { BudgetReport } from "../core/budget-insights.js";
import type { InputWidget } from "./input.js";
import type { Session, SessionTreeItem } from "../core/session.js";
import type { TreeFilterMode } from "../core/config.js";
import type { ModelLaneOption, ModelOption, PickerItem, SettingEntry, UpdateNotice, MenuPromptKind } from "../ui-contracts.js";
export type { ModelLaneOption, ModelOption, PickerItem, SettingEntry, UpdateNotice, MenuPromptKind } from "../ui-contracts.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  thinkingDuration?: number;
  images?: ResolvedImage[];
}

export interface BtwBubble {
  question: string;
  answer: string;
  modelLabel: string;
  pending: boolean;
  error?: string;
  abort?: () => void;
}

export interface BudgetView {
  title: string;
  reports: {
    all: BudgetReport;
    session: BudgetReport;
  };
  scope: "all" | "session";
  section: "usage" | "efficiency" | "routing" | "context";
  scrollOffset: number;
}

export interface TreeView {
  title: string;
  session: Session;
  filterMode: TreeFilterMode;
  selectedId: string | null;
  scrollOffset: number;
  collapsedIds: Set<string>;
  showLabelTimestamps: boolean;
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
  inputMode: boolean;
  answers: Record<string, QuestionAnswer>;
  editor: InputWidget;
  resolve: (result: QuestionResult) => void;
}

export type PendingDelivery = "steering" | "followup";

export interface ActivityStep {
  label: string;
  detail?: string;
  status: "running" | "done";
  startedAt: number;
  completedAt?: number;
}

export interface ToolExecutionActivity {
  id: string;
  callId?: string;
  name: string;
  preview: string;
  args?: unknown;
  resultDetail?: string;
  result?: string;
  error?: boolean;
  expanded: boolean;
  streamOutput?: string;
  status: "starting" | "running" | "done" | "failed";
  startedAt: number;
  completedAt?: number;
}

export interface TreeRow {
  item: SessionTreeItem;
  marker: string;
  text: string;
  branchStart: boolean;
  collapsed: boolean;
}

export interface MenuEntry {
  lines: string[];
  selectIndex?: number;
}

export type ResolvedImage = { mimeType: string; data: string };
export type PendingImage =
  | (ResolvedImage & { attachmentId?: string; resolvedPath?: string; pendingPath?: undefined })
  | { attachmentId?: string; pendingPath: string; resolvedPath?: undefined; mimeType?: undefined; data?: undefined };
export type PendingMessage = { text: string; images?: ResolvedImage[]; delivery: PendingDelivery };
export type TodoItem = { id: string; text: string; status: "pending" | "in_progress" | "done" };
export type MascotGrid = Array<Array<RgbColor | null>>;
