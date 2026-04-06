import {
  appendFilePicker,
  appendItemPicker,
  appendModelPicker,
  appendSettingsPicker,
  decorateFrameLine,
  draw,
  drawImmediate,
  drawNow,
  getCommandMatches,
  shimmerText,
  sparkleSpinner,
  start,
  stop,
} from "./app-draw-methods.js";

type AppState = any;

export interface AppDrawMethods {
  draw(): void;
  drawNow(): void;
  drawImmediate(): void;
  sparkleSpinner(frame: number, color?: string): string;
  shimmerText(text: string, frame: number, color?: string): string;
  appendModelPicker(lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void;
  decorateFrameLine(line: string, targetWidth: number): string;
  appendFilePicker(lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void;
  appendSettingsPicker(lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void;
  appendItemPicker(lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>): void;
  getCommandMatches(): ReturnType<typeof getCommandMatches>;
  start(): void;
  stop(): void;
}

export const appDrawMethods: AppDrawMethods = {
  draw(this: AppState) { return draw(this); },
  drawNow(this: AppState) { return drawNow(this); },
  drawImmediate(this: AppState) { return drawImmediate(this); },
  sparkleSpinner(this: AppState, frame: number, color?: string) { return sparkleSpinner(this, frame, color); },
  shimmerText(this: AppState, text: string, frame: number, color?: string) { return shimmerText(this, text, frame, color); },
  appendModelPicker(this: AppState, lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>) { return appendModelPicker(this, lines, maxTotal, clickTargets); },
  decorateFrameLine(this: AppState, line: string, targetWidth: number) { return decorateFrameLine(this, line, targetWidth); },
  appendFilePicker(this: AppState, lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>) { return appendFilePicker(this, lines, maxTotal, clickTargets); },
  appendSettingsPicker(this: AppState, lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>) { return appendSettingsPicker(this, lines, maxTotal, clickTargets); },
  appendItemPicker(this: AppState, lines: string[], maxTotal: number, clickTargets: Array<{ lineIndex: number; action: () => void }>) { return appendItemPicker(this, lines, maxTotal, clickTargets); },
  getCommandMatches(this: AppState) { return getCommandMatches(this); },
  start(this: AppState) { return start(this); },
  stop(this: AppState) { return stop(this); },
};
