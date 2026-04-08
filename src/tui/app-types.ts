import type { RgbColor } from "./render/mascot.js";
import type { BudgetReport } from "../core/budget-insights.js";
import type { UpdateInfo } from "../core/update.js";
import type { InputWidget } from "./input.js";
import type { Session, SessionTreeItem } from "../core/session.js";
import type { TreeFilterMode } from "../core/config.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  images?: ResolvedImage[];
}

export interface ModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName?: string;
  active: boolean;
  badges?: string[];
  isHeader?: boolean;
}

export interface ModelLaneOption {
  id: string;
  slot: "all" | "default" | "small" | "btw" | "review" | "planning" | "ui" | "architecture";
  label: string;
  detail: string;
  assignedModelLabel?: string;
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
  tone?: "default" | "danger";
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

export type UpdateNotice = UpdateInfo;

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

export type MenuPromptKind =
  | "model"
  | "mode"
  | "name"
  | "login"
  | "connect"
  | "settings"
  | "extensions"
  | "export"
  | "resume"
  | "session"
  | "hotkeys"
  | "tree"
  | "templates"
  | "skills"
  | "changelog"
  | "projects"
  | "logout";

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
