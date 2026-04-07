import { getPrettyModelName } from "../ai/model-catalog.js";
import { DIM, RESET } from "../utils/ansi.js";
import { T, TXT } from "./app-shared.js";
import type { MenuEntry, ModelLaneOption } from "./app-types.js";

type AppState = any;

const MODEL_LANE_OPTIONS: ModelLaneOption[] = [
  { id: "default", slot: "default", label: "Use for chat", detail: "main assistant model" },
  { id: "small", slot: "small", label: "Use for fast", detail: "cheap/simple turns" },
  { id: "review", slot: "review", label: "Use for review", detail: "audits and code review" },
  { id: "planning", slot: "planning", label: "Use for planning", detail: "plans and research" },
  { id: "ui", slot: "ui", label: "Use for design/UI", detail: "frontend and styling work" },
  { id: "architecture", slot: "architecture", label: "Use for architecture", detail: "system design work" },
];

export function getModelLanePickerEntries(app: AppState): MenuEntry[] {
  if (!app.modelLanePicker) return [];
  return app.modelLanePicker.options.map((option: ModelLaneOption, i: number) => {
    const isCursor = i === app.modelLanePicker.cursor;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const labelCol = isCursor ? `${TXT()}` : T();
    return { text: ` ${arrow}${labelCol}${option.label}${RESET} ${DIM}${option.detail}${RESET}`, selectIndex: i };
  });
}

export function openModelLanePicker(app: AppState, index: number): void {
  if (!app.modelPicker) return;
  const filtered = app.getFilteredModels();
  const selected = filtered[index];
  if (!selected) return;
  app.modelPicker.cursor = index;
  app.modelLanePicker = {
    model: { ...selected, displayName: selected.displayName ?? getPrettyModelName(selected.modelId) },
    cursor: 0,
    options: MODEL_LANE_OPTIONS.map((option) => ({ ...option })),
  };
  app.draw();
}

export function selectModelLaneEntry(app: AppState, index: number): void {
  if (!app.modelLanePicker) return;
  const choice = app.modelLanePicker.options[index];
  const selected = app.modelLanePicker.model;
  if (!choice || !selected) return;
  app.onModelAssign?.(selected.providerId, selected.modelId, choice.slot);
  app.modelLanePicker = null;
  app.drawNow();
}
