import type { UpdateInfo } from "./core/update.js";
import type { ModelPreferenceSlot } from "./core/config.js";
import type { Keypress } from "./utils/keypress-types.js";

export interface ModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName?: string;
  active: boolean;
  badges?: string[];
  tone?: "default" | "auto";
  isHeader?: boolean;
}

export interface ModelLaneOption {
  id: string;
  slot: "all" | ModelPreferenceSlot;
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

export type MenuPromptKind =
  | "model"
  | "mode"
  | "name"
  | "login"
  | "settings"
  | "extensions"
  | "theme"
  | "export"
  | "resume"
  | "session"
  | "hotkeys"
  | "tree"
  | "templates"
  | "skills"
  | "changelog"
  | "projects"
  | "packages"
  | "providers"
  | "logout";

export type UpdateNotice = UpdateInfo;

export type PendingDelivery = "steering" | "followup";

export interface ItemPickerOptions {
  initialCursor?: number;
  previewHint?: string;
  onPreview?: (id: string) => void;
  onCancel?: () => void;
  onSecondaryAction?: (id: string) => void;
  onKey?: (key: Keypress) => boolean;
  secondaryHint?: string;
  closeOnSelect?: boolean;
  kind?: Exclude<MenuPromptKind, "model">;
}
