import type { PickerItem, SettingEntry, ModelLaneOption, ModelOption } from "./app-types.js";
import type { ModelPreferenceSlot } from "../core/config.js";
import type { ItemPickerOptions } from "../ui-contracts.js";
import type { SidebarTreeItem } from "./sidebar.js";

export interface ModelPickerState {
  options: ModelOption[];
  cursor: number;
  scope: "all" | "scoped";
}

export interface SettingsPickerState {
  entries: SettingEntry[];
  cursor: number;
}

export interface FilePickerState {
  files: string[];
  filtered: string[];
  query: string;
  cursor: number;
}

export interface ItemPickerState extends ItemPickerOptions {
  title: string;
  items: PickerItem[];
  cursor: number;
}

export interface ModelLanePickerState {
  model: ModelOption;
  options: ModelLaneOption[];
  cursor: number;
}

export interface AppPickerState {
  model: ModelPickerState | null;
  settings: SettingsPickerState | null;
  file: FilePickerState | null;
  item: ItemPickerState | null;
  modelLane: ModelLanePickerState | null;
  onModelSelect: ((providerId: string, modelId: string) => void) | null;
  onModelPin: ((providerId: string, modelId: string, pinned: boolean) => void) | null;
  onModelAssign: ((providerId: string, modelId: string, slot: ModelPreferenceSlot) => void) | null;
  onSettingToggle: ((key: string) => void) | null;
  onTreeSelect: ((entryId: string) => void | Promise<void>) | null;
  onItemSelect: ((id: string) => void) | null;
}

export function createAppPickerState(): AppPickerState {
  return {
    model: null,
    settings: null,
    file: null,
    item: null,
    modelLane: null,
    onModelSelect: null,
    onModelPin: null,
    onModelAssign: null,
    onSettingToggle: null,
    onTreeSelect: null,
    onItemSelect: null,
  };
}

export interface AppSidebarState {
  fileTree: SidebarTreeItem[] | null;
  expandedDirs: Set<string>;
  treeOpen: boolean;
  scrollOffset: number;
  focused: boolean;
}

export function createAppSidebarState(): AppSidebarState {
  return {
    fileTree: null,
    expandedDirs: new Set<string>(),
    treeOpen: false,
    scrollOffset: 0,
    focused: false,
  };
}
