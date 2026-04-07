import { getPrettyModelName } from "../ai/model-catalog.js";
import { getResolvedModelPreference } from "../cli/model-routing.js";
import { DIM, RESET } from "../utils/ansi.js";
import { T, TXT } from "./app-shared.js";
import type { MenuEntry, ModelLaneOption } from "./app-types.js";

type AppState = any;

const MODEL_LANE_OPTIONS: ModelLaneOption[] = [
  { id: "all", slot: "all", label: "Use everywhere", detail: "set this as chat, fast, review, planning, design/UI, and architecture" },
  { id: "default", slot: "default", label: "Use for chat", detail: "switch to it now and make it the main chat model" },
  { id: "small", slot: "small", label: "Use for fast", detail: "auto-route, cheap turns, and chat naming" },
  { id: "review", slot: "review", label: "Use for review", detail: "audits and code review" },
  { id: "planning", slot: "planning", label: "Use for planning", detail: "plans and research" },
  { id: "ui", slot: "ui", label: "Use for design/UI", detail: "frontend and styling work" },
  { id: "architecture", slot: "architecture", label: "Use for architecture", detail: "system design work" },
];

function getAssignedModelLabel(app: AppState, slot: Exclude<ModelLaneOption["slot"], "all">, selected: { providerId: string; modelId: string; displayName?: string }): string | undefined {
  const resolved = getResolvedModelPreference(slot, app.modelProviderId || selected.providerId);
  if (!resolved) return undefined;
  if (resolved.providerId === selected.providerId && resolved.modelId === selected.modelId) return "already selected";
  return getPrettyModelName(resolved.modelId);
}

export function getModelLanePickerEntries(app: AppState): MenuEntry[] {
  if (!app.modelLanePicker) return [];
  return app.modelLanePicker.options.map((option: ModelLaneOption, i: number) => {
    const isCursor = i === app.modelLanePicker.cursor;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const labelCol = isCursor ? `${TXT()}` : T();
    const assignment = option.assignedModelLabel ? ` ${DIM}(${option.assignedModelLabel})${RESET}` : "";
    return { text: ` ${arrow}${labelCol}${option.label}${RESET}${assignment} ${DIM}${option.detail}${RESET}`, selectIndex: i };
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
    options: MODEL_LANE_OPTIONS.map((option) => {
      if (option.slot === "all") return { ...option };
      return {
        ...option,
        assignedModelLabel: getAssignedModelLabel(app, option.slot, selected),
      };
    }),
  };
  app.draw();
}

export function selectModelLaneEntry(app: AppState, index: number): void {
  if (!app.modelLanePicker) return;
  const choice = app.modelLanePicker.options[index];
  const selected = app.modelLanePicker.model;
  if (!choice || !selected) return;
  if (choice.slot === "all") {
    app.onModelSelect?.(selected.providerId, selected.modelId);
    for (const slot of ["default", "small", "review", "planning", "ui", "architecture"] as const) {
      app.onModelAssign?.(selected.providerId, selected.modelId, slot);
    }
  } else if (choice.slot === "default") {
    app.onModelSelect?.(selected.providerId, selected.modelId);
    app.onModelAssign?.(selected.providerId, selected.modelId, choice.slot);
  } else {
    app.onModelAssign?.(selected.providerId, selected.modelId, choice.slot);
  }
  app.modelPicker = null;
  app.input.clear();
  app.modelLanePicker = null;
  app.drawNow();
}
