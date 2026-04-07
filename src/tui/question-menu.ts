import { currentQuestionField, isQuestionSubmitTab } from "./question-view.js";

type AppState = any;

export function getQuestionMenuLineCount(app: AppState, maxVisibleRows: number, maxVisibleMenuRows: number): number {
  const field = currentQuestionField(app.questionView);
  if (field && field.kind !== "text" && !isQuestionSubmitTab(app.questionView)) {
    const visible = Math.min(field.options.length || 1, maxVisibleRows, maxVisibleMenuRows);
    return 3 + Math.max(1, visible);
  }
  return 4;
}

export function scrollQuestionMenu(app: AppState, delta: number): boolean {
  const field = currentQuestionField(app.questionView);
  if (!field || field.kind === "text" || isQuestionSubmitTab(app.questionView)) return false;
  app.questionView.optionCursor = app.clampMenuCursor(app.questionView.optionCursor + delta, field.options.length);
  return true;
}
