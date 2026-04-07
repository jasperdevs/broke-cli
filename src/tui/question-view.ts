import type { Keypress } from "./keypress.js";
import { InputWidget } from "./input.js";
import type { MenuEntry, QuestionAnswer, QuestionField, QuestionOption, QuestionRequest, QuestionResult, QuestionView } from "./app-types.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { T, TXT, MUTED, OK } from "./app-shared.js";
import { wordWrap } from "./render/formatting.js";

type AppState = any;

function questionAnswered(view: QuestionView, fieldId: string): boolean {
  return !!view.answers[fieldId];
}

function allRequiredAnswered(view: QuestionView): boolean {
  return view.questions.every((field) => !field.required || questionAnswered(view, field.id));
}

export function currentQuestionField(view: QuestionView): QuestionField | null {
  return view.activeIndex >= 0 && view.activeIndex < view.questions.length ? view.questions[view.activeIndex] : null;
}

export function isQuestionSubmitTab(view: QuestionView): boolean {
  return view.questions.length > 1 && view.activeIndex === view.questions.length;
}

function normalizeEditorForField(view: QuestionView, field: QuestionField): void {
  if (field.kind !== "text") return;
  const existing = view.answers[field.id];
  if (typeof existing?.value === "string") view.editor.setText(existing.value);
  else view.editor.setText("");
}

export function createQuestionView(request: QuestionRequest, resolve: (result: QuestionResult) => void): QuestionView {
  const editor = new InputWidget();
  const view: QuestionView = {
    title: request.title,
    submitLabel: request.submitLabel,
    questions: request.questions,
    activeIndex: 0,
    optionCursor: 0,
    answers: {},
    editor,
    resolve,
  };
  const first = currentQuestionField(view);
  if (first) normalizeEditorForField(view, first);
  return view;
}

function moveQuestion(view: QuestionView, delta: number): void {
  if (view.questions.length <= 1) return;
  const maxIndex = view.questions.length;
  view.activeIndex = Math.max(0, Math.min(maxIndex, view.activeIndex + delta));
  view.optionCursor = 0;
  const field = currentQuestionField(view);
  if (field) normalizeEditorForField(view, field);
}

function serializeAnswers(view: QuestionView): QuestionAnswer[] {
  return view.questions
    .map((field) => view.answers[field.id])
    .filter((answer): answer is QuestionAnswer => !!answer);
}

function finishQuestionView(app: AppState, cancelled: boolean): void {
  const view = app.questionView as QuestionView;
  if (!view) return;
  const result: QuestionResult = {
    cancelled,
    answers: cancelled ? [] : serializeAnswers(view),
  };
  app.questionView = null;
  app.drawNow();
  view.resolve(result);
}

function storeSingleAnswer(view: QuestionView, field: QuestionField, option: QuestionOption): void {
  view.answers[field.id] = {
    id: field.id,
    kind: field.kind,
    value: option.value,
    label: option.label,
  };
}

function toggleMultiAnswer(view: QuestionView, field: QuestionField, option: QuestionOption): void {
  const existing = view.answers[field.id];
  const values = Array.isArray(existing?.value) ? [...existing.value] : [];
  const labels = Array.isArray(existing?.label) ? [...existing.label] : [];
  const idx = values.indexOf(option.value);
  if (idx >= 0) {
    values.splice(idx, 1);
    labels.splice(idx, 1);
  } else {
    const maxSelections = Math.max(1, field.maxSelections ?? field.options.length);
    if (values.length >= maxSelections) {
      values.shift();
      labels.shift();
    }
    values.push(option.value);
    labels.push(option.label);
  }
  if (values.length === 0) {
    delete view.answers[field.id];
    return;
  }
  view.answers[field.id] = {
    id: field.id,
    kind: field.kind,
    value: values,
    label: labels,
  };
}

function storeTextAnswer(view: QuestionView, field: QuestionField): boolean {
  const value = view.editor.getText().trim();
  if (!value && field.required) return false;
  if (!value) {
    delete view.answers[field.id];
    return true;
  }
  view.answers[field.id] = {
    id: field.id,
    kind: field.kind,
    value,
    label: value,
    custom: true,
  };
  return true;
}

function advanceAfterAnswer(app: AppState): void {
  const view = app.questionView as QuestionView;
  if (!view) return;
  if (view.questions.length === 1) {
    finishQuestionView(app, false);
    return;
  }
  if (view.activeIndex < view.questions.length) {
    view.activeIndex = Math.min(view.questions.length, view.activeIndex + 1);
    view.optionCursor = 0;
    const field = currentQuestionField(view);
    if (field) normalizeEditorForField(view, field);
  }
  app.draw();
}

function appWrap(text: string, width: number): string[] {
  const lines = text.split("\n");
  const wrapped: string[] = [];
  for (const line of lines) {
    const chunks = line.length === 0 ? [""] : wordWrap(line, Math.max(8, width - 2));
    wrapped.push(...chunks);
  }
  return wrapped;
}

function buildFooter(view: QuestionView): string {
  if (isQuestionSubmitTab(view)) return `${DIM}enter submit · esc cancel${RESET}`;
  const field = currentQuestionField(view);
  if (!field) return `${DIM}esc cancel${RESET}`;
  if (field.kind === "text") return `${DIM}shift+enter newline · enter next · tab switch · esc cancel${RESET}`;
  if (field.kind === "multi") return `${DIM}↑↓ move · space toggle · enter next · tab switch · esc cancel${RESET}`;
  return `${DIM}↑↓ move · enter select · tab switch · esc cancel${RESET}`;
}

export function getQuestionHeader(view: QuestionView): string {
  const total = view.questions.length + (view.questions.length > 1 ? 1 : 0);
  const current = Math.min(total, Math.max(1, view.activeIndex + 1));
  return ` ${T()}${BOLD}${view.title}${RESET} ${DIM}(${current}/${total})${RESET}`;
}

export function getQuestionBodyLines(view: QuestionView, width: number): string[] {
  if (isQuestionSubmitTab(view)) {
    const lines: string[] = [` ${TXT()}${BOLD}${view.submitLabel}${RESET}`];
    for (const field of view.questions) {
      const answer = view.answers[field.id];
      const value = !answer
        ? `${DIM}[required]${RESET}`
        : Array.isArray(answer.label)
          ? answer.label.join(", ")
          : answer.label;
      lines.push(` ${T()}${field.label}${RESET} ${value}`);
    }
    lines.push(` ${buildFooter(view)}`);
    return lines;
  }

  const field = currentQuestionField(view);
  if (!field) return [` ${buildFooter(view)}`];

  const lines: string[] = [` ${TXT()}${BOLD}${field.prompt}${RESET}`];
  if (field.kind === "text") {
    const editorText = view.editor.getText();
    const wrapped = editorText.length > 0
      ? appWrap(editorText, width)
      : [`${DIM}${field.placeholder ?? "type response"}${RESET}`];
    for (const line of wrapped) lines.push(` ${line}`);
    lines.push(` ${buildFooter(view)}`);
    return lines;
  }

  const selectedValue = view.answers[field.id]?.value;
  const optionEntries: MenuEntry[] = field.options.map((option, index) => {
    const isCursor = index === view.optionCursor;
    const selected = field.kind === "multi"
      ? Array.isArray(selectedValue) && selectedValue.includes(option.value)
      : selectedValue === option.value;
    const arrow = isCursor ? `${T()}>${RESET}` : " ";
    const mark = field.kind === "multi"
      ? selected ? `${OK()}[x]${RESET}` : `${DIM}[ ]${RESET}`
      : selected ? `${OK()}(•)${RESET}` : `${DIM}( )${RESET}`;
    const label = isCursor ? `${TXT()}${BOLD}${option.label}${RESET}` : `${TXT()}${option.label}${RESET}`;
    return { text: ` ${arrow} ${mark} ${label}`, selectIndex: index };
  });

  lines.push(...optionEntries.map((entry) => entry.text));
  lines.push(` ${buildFooter(view)}`);
  return lines;
}

export function getQuestionOptionEntries(view: QuestionView): MenuEntry[] {
  if (isQuestionSubmitTab(view)) return [];
  const field = currentQuestionField(view);
  if (!field || field.kind === "text") return [];
  const selectedValue = view.answers[field.id]?.value;
  return field.options.map((option, index) => {
    const isCursor = index === view.optionCursor;
    const selected = field.kind === "multi"
      ? Array.isArray(selectedValue) && selectedValue.includes(option.value)
      : selectedValue === option.value;
    const arrow = isCursor ? `${T()}>${RESET}` : " ";
    const mark = field.kind === "multi"
      ? selected ? `${OK()}[x]${RESET}` : `${DIM}[ ]${RESET}`
      : selected ? `${OK()}(•)${RESET}` : `${DIM}( )${RESET}`;
    const label = isCursor ? `${TXT()}${BOLD}${option.label}${RESET}` : `${TXT()}${option.label}${RESET}`;
    return { text: ` ${arrow} ${mark} ${label}`, selectIndex: index };
  });
}

export function getQuestionCursor(app: AppState, width: number): { rowOffset: number; col: number } | null {
  const view = app.questionView as QuestionView;
  if (!view || isQuestionSubmitTab(view)) return null;
  const field = currentQuestionField(view);
  if (!field || field.kind !== "text") return null;
  const layout = app.getInputCursorLayout(view.editor.getText(), view.editor.getCursor(), width);
  return {
    rowOffset: 1 + layout.row,
    col: 2 + layout.col,
  };
}

export function handleQuestionViewKey(app: AppState, key: Keypress): void {
  const view = app.questionView as QuestionView;
  if (!view) return;

  if (key.name === "escape" || (key.ctrl && key.name === "c")) {
    finishQuestionView(app, true);
    return;
  }

  if ((key.name === "tab" && !key.shift) || key.name === "right") {
    moveQuestion(view, 1);
    app.draw();
    return;
  }
  if ((key.name === "tab" && key.shift) || key.name === "left") {
    moveQuestion(view, -1);
    app.draw();
    return;
  }

  if (isQuestionSubmitTab(view)) {
    if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl && allRequiredAnswered(view)) {
      finishQuestionView(app, false);
      return;
    }
    app.draw();
    return;
  }

  const field = currentQuestionField(view);
  if (!field) {
    app.draw();
    return;
  }

  if (field.kind === "text") {
    if (key.name === "up" || key.name === "down") {
      app.draw();
      return;
    }
    if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
      if (storeTextAnswer(view, field)) advanceAfterAnswer(app);
      else app.draw();
      return;
    }
    view.editor.handleKey(key);
    app.draw();
    return;
  }

  if (key.name === "up") {
    view.optionCursor = Math.max(0, view.optionCursor - 1);
    app.draw();
    return;
  }
  if (key.name === "down") {
    view.optionCursor = Math.min(field.options.length - 1, view.optionCursor + 1);
    app.draw();
    return;
  }

  const option = field.options[view.optionCursor];
  if (!option) {
    app.draw();
    return;
  }

  if (field.kind === "multi" && key.name === "space") {
    toggleMultiAnswer(view, field, option);
    app.draw();
    return;
  }

  if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
    if (field.kind === "single") {
      storeSingleAnswer(view, field, option);
      advanceAfterAnswer(app);
      return;
    }
    if (field.kind === "multi") {
      const answer = view.answers[field.id];
      if (field.required && (!answer || !Array.isArray(answer.value) || answer.value.length === 0)) {
        app.draw();
        return;
      }
      advanceAfterAnswer(app);
      return;
    }
  }

  app.draw();
}
